// Resposta real de e-mail → lead certo → interação 'resposta' → cadência
// cancelada. É o caminho que falhou no teste real da campanha TESTE FLUXO
// (org testeqa, 19/09/2026): o lead respondeu "Top, tenho interesse" e foi
// parar em 'perdido', porque o rodapé de descadastro da NOSSA mensagem vinha
// citado embaixo da resposta e disparava a regra de negativo.
//
// Cobre também as garantias vizinhas que esse caminho não pode quebrar:
// resposta de um lead não encosta em outro, store escopado numa organização
// não enxerga lead de outra, e remetente desconhecido não vira resposta.
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { detectarResposta } from '../flows/detectarResposta'
import { classificarResposta, type ClassificadorIa } from '@/lib/comercial/respostas/classificarResposta'
import type { EntradaGatilhoProspeccao, ResultadoGatilhoProspeccao } from '@/lib/comercial/handoff/gatilhoProspeccao'
import type { Lead, MensagemRecebida } from '../types'
import { makeLead, ONTEM } from './helpers'

const RODAPE_CAMPANHA = 'Caso não queira mais receber nossos e-mails, clique aqui para se descadastrar.'

// Resposta como o Gmail monta: texto novo em cima, mensagem original citada.
function respostaCitando(texto: string): string {
  return `${texto}\n\nEm sáb., 19 de set. de 2026 às 16:11, <remetente@campanha.com>\nescreveu:\n\n> Prospecção\n>\n> Olá, tudo bem?\n>\n> ${RODAPE_CAMPANHA}\n`
}

function msg(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: over.de ?? 'ana@acme.com.br',
    assunto: over.assunto ?? 'Re: TESTE FLUXO',
    corpo: over.corpo ?? respostaCitando('Top, tenho interesse'),
    automatica: over.automatica,
    em: over.em ?? new Date(),
    mensagemId: over.mensagemId,
  }
}

// Store que registra quais leads tiveram a cadência cancelada (o MemoryStore
// não rastreia workflow_execucoes) e, quando recebe uma organização, isola as
// leituras por lead como o SupabaseStore faz via `.eq('organizacao_id', ...)`.
class StoreDeTeste extends MemoryStore {
  cancelados: string[] = []
  constructor(leads: Lead[] = [], private readonly org?: string) {
    super(leads)
    this.organizacaoId = org
  }
  declare organizacaoId?: string
  private daOrg(lead: Lead | null): Lead | null {
    if (!lead) return null
    if (!this.org) return lead
    return (lead as Lead & { organizacao_id?: string }).organizacao_id === this.org ? lead : null
  }
  override async buscarLeadPorEmail(email: string): Promise<Lead | null> {
    return this.daOrg(await super.buscarLeadPorEmail(email))
  }
  override async buscarLeadPorDominio(dominio: string): Promise<Lead | null> {
    return this.daOrg(await super.buscarLeadPorDominio(dominio))
  }
  override async cancelarExecucoesWorkflow(leadId: string): Promise<void> {
    this.cancelados.push(leadId)
  }
}

const iaFixa = (r: 'positivo' | 'negativo' | 'neutro'): ClassificadorIa => async () => r

// Hook de handoff mínimo: o detector só classifica quando ele está presente.
// Devolve o caso "ninguém no rodízio" — registra o handoff e não avisa ninguém,
// que é o suficiente para exercitar a classificação sem montar o módulo real.
function hookHandoff(): (e: EntradaGatilhoProspeccao) => Promise<ResultadoGatilhoProspeccao> {
  return async (entrada) => ({
    handoff: {
      tipo: 'aguardando_distribuicao',
      handoff: {
        id: 'handoff-teste',
        organizacaoId: entrada.organizacaoId,
        leadId: entrada.leadId,
        eventoId: entrada.eventoId,
        origem: 'prospeccao',
        responsavelId: null,
        motivo: null,
        primeiraAtribuicao: null,
        status: 'aguardando_distribuicao',
        atribuidoEm: null,
        encerradoEm: null,
        encerradoMotivo: null,
        criadoEm: new Date().toISOString(),
      },
    },
    responsavel: null,
    notificacao: null,
  })
}

function opts(ia: 'positivo' | 'negativo' | 'neutro' = 'positivo') {
  return {
    classificarResposta: (r: { assunto: string; corpo: string }) => classificarResposta(r, iaFixa(ia)),
    handoffProspeccao: hookHandoff(),
  }
}

function interacoesDe(store: MemoryStore, leadId: string, tipo: string) {
  return store.interacoes.filter((i) => i.lead_id === leadId && i.tipo === tipo)
}

describe('resposta de e-mail encerra a cadência do lead certo', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => {
    email = new SimulatedProvider()
    fila = new Queue()
  })

  it('casa o lead pelo e-mail, registra a interação de resposta e cancela a execução', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([lead])
    email.injetar(msg({ de: 'ana@acme.com.br' }))

    const r = await detectarResposta(store, email, fila, opts('positivo'))

    expect(r.respostas).toBe(1)
    const respostas = interacoesDe(store, lead.id, 'resposta')
    expect(respostas).toHaveLength(1)
    expect(respostas[0].descricao).toContain('Top, tenho interesse')
    expect(store.cancelados).toEqual([lead.id])
  })

  // REGRESSÃO da causa raiz: classificar o corpo inteiro lia o nosso próprio
  // rodapé de descadastro e mandava o lead para 'perdido', sem handoff.
  it('resposta positiva que cita o rodapé da campanha vira interessado, não perdido', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([lead])
    email.injetar(msg({ de: 'ana@acme.com.br', corpo: respostaCitando('Top, tenho interesse') }))

    await detectarResposta(store, email, fila, opts('positivo'))

    const atualizado = await store.buscarLead(lead.id)
    expect(atualizado?.estagio).toBe('interessado')
    expect(atualizado?.perdido).toBe(false)
    expect(atualizado?.proxima_acao).toBe('aguardando_closer')
    expect(store.cancelados).toEqual([lead.id])
  })

  it('recusa escrita pelo lead continua encerrando como perdido', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([lead])
    email.injetar(msg({ de: 'ana@acme.com.br', corpo: respostaCitando('Não tenho interesse, obrigado.') }))

    await detectarResposta(store, email, fila, opts('positivo'))

    const atualizado = await store.buscarLead(lead.id)
    expect(atualizado?.estagio).toBe('perdido')
    expect(atualizado?.perdido).toBe(true)
    expect(store.cancelados).toEqual([lead.id])
  })

  it('mensagens_processadas impede efeitos duplicados para a mesma mensagem', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([lead])
    const duplicada = msg({ de: 'ana@acme.com.br', mensagemId: '<resposta-1@acme.com.br>' })
    email.injetar(duplicada, { ...duplicada })

    const r = await detectarResposta(store, email, fila, opts('positivo'))

    expect(r.respostas).toBe(1)
    expect(interacoesDe(store, lead.id, 'resposta')).toHaveLength(1)
    expect(store.cancelados).toEqual([lead.id])
    expect(store.mensagensProcessadas).toEqual(new Set(['<resposta-1@acme.com.br>']))
  })

  it('resposta do lead A não encosta na cadência do lead B', async () => {
    const a = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const b = makeLead({ estagio: 'primeiro_contato', contato_email: 'bruno@outra.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([a, b])
    email.injetar(msg({ de: 'ana@acme.com.br' }))

    await detectarResposta(store, email, fila, opts('positivo'))

    expect(store.cancelados).toEqual([a.id])
    expect(interacoesDe(store, b.id, 'resposta')).toHaveLength(0)
    const leadB = await store.buscarLead(b.id)
    expect(leadB?.estagio).toBe('primeiro_contato')
  })

  it('não trata resposta de lead de OUTRA organização', async () => {
    const daOutraOrg = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    ;(daOutraOrg as Lead & { organizacao_id?: string }).organizacao_id = 'org-b'
    const store = new StoreDeTeste([daOutraOrg], 'org-a')
    email.injetar(msg({ de: 'ana@acme.com.br' }))

    const r = await detectarResposta(store, email, fila, opts('positivo'))

    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(1)
    expect(store.cancelados).toEqual([])
    expect(store.interacoes).toHaveLength(0)
  })

  it('mensagem de remetente desconhecido não vira resposta nem cancela nada', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: ONTEM })
    const store = new StoreDeTeste([lead])
    email.injetar(msg({ de: 'newsletter@fornecedor-qualquer.com', assunto: 'Novidades da semana' }))

    const r = await detectarResposta(store, email, fila, opts('positivo'))

    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(1)
    expect(store.cancelados).toEqual([])
    expect(store.interacoes).toHaveLength(0)
    const atualizado = await store.buscarLead(lead.id)
    expect(atualizado?.estagio).toBe('primeiro_contato')
  })
})
