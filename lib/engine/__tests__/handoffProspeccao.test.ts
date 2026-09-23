// Fase 2 do handoff comercial NO MOTOR: detectarResposta classifica a resposta
// de prospecção e, só quando positiva, chama o gatilho de handoff (injetado);
// a cadência é encerrada ANTES; follow-ups futuros não saem. Tudo com fakes.
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { detectarResposta, descreverEtapaCadencia, respostaVemDeProspeccao } from '../flows/detectarResposta'
import { followUp } from '../flows/followUp'
import type { ContextoCampanhaResposta, MensagemRecebida } from '../types'
import { makeLead, SEMANA_PASSADA, ONTEM } from './helpers'
import type { ClassificacaoResposta } from '@/lib/comercial/respostas/classificarResposta'
import type { EntradaGatilhoProspeccao, ResultadoGatilhoProspeccao } from '@/lib/comercial/handoff/gatilhoProspeccao'

function msg(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: over.de ?? 'ana@acme.com.br',
    assunto: over.assunto ?? 'Re: proposta',
    corpo: over.corpo ?? 'Tenho interesse, podemos conversar?',
    automatica: over.automatica,
    em: over.em ?? new Date(),
    mensagemId: over.mensagemId ?? '<msg-1@acme>',
  }
}

// Classificador falso: decide pelo corpo, sem IA.
const classificar = (c: ClassificacaoResposta) => async () => ({ classificacao: c, via: 'ia' as const })

// Gatilho falso: registra as chamadas e devolve um handoff "atribuído".
function gatilhoFake(resposta: 'atribuido' | 'aguardando' = 'atribuido') {
  const chamadas: EntradaGatilhoProspeccao[] = []
  const hook = async (e: EntradaGatilhoProspeccao): Promise<ResultadoGatilhoProspeccao> => {
    chamadas.push(e)
    const handoff = {
      id: 'h1', organizacaoId: e.organizacaoId, leadId: e.leadId, eventoId: e.eventoId, origem: 'prospeccao',
      responsavelId: 'bruno', motivo: 'round_robin' as const, primeiraAtribuicao: true,
      status: 'em_contato_comercial' as const, atribuidoEm: 'x', encerradoEm: null, encerradoMotivo: null, criadoEm: 'x',
    }
    if (resposta === 'aguardando') {
      return { handoff: { tipo: 'aguardando_distribuicao', handoff: { ...handoff, responsavelId: null, motivo: null, primeiraAtribuicao: null, status: 'aguardando_distribuicao', atribuidoEm: null } }, responsavel: null, notificacao: null }
    }
    return {
      handoff: { tipo: 'atribuido', motivo: 'round_robin', primeiraAtribuicao: true, responsavel: { id: 'bruno', nome: 'Bruno' }, handoff },
      responsavel: { id: 'bruno', nome: 'Bruno', email: 'bruno@a' },
      notificacao: { tipo: 'enviada', notificacao: { id: 'n1', organizacaoId: e.organizacaoId, handoffId: 'h1', tipo: 'grupo_comercial', status: 'enviada', tentativas: 1, ultimoErro: null, dados: { empresa: '', contato: '', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: e.etapaCadencia }, destino: 'g', providerMessageId: 'z1', enviadoEm: 'x', criadoEm: 'x', codigoRef: null } },
    }
  }
  return { hook, chamadas }
}

// Store em memória com cancelamento de execuções e contexto de campanha observáveis.
class StoreTeste extends MemoryStore {
  readonly organizacaoId = 'org-a'
  cancelamentos: string[] = []
  contexto: ContextoCampanhaResposta | null = null
  async cancelarExecucoesWorkflow(leadId: string) { this.cancelamentos.push(leadId) }
  async buscarContextoCampanhaAtiva() { return this.contexto }
}

const contextoCampanha = (tipo: string, cicloChave: string | null = null): ContextoCampanhaResposta => ({
  id: 'c1', execucaoId: 'e1', iniciadoEm: SEMANA_PASSADA, execucaoStatus: 'aguardando', cicloChave, nome: 'Campanha X', tipo,
  responsavel: null, notificarResponsavel: true, emailAssunto: null, emailCorpo: null, emailHtml: null,
})

describe('handoff no motor — resposta de prospecção', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => { email = new SimulatedProvider(); fila = new Queue() })

  it('1. positivo no PRIMEIRO CONTATO → cadência encerrada + handoff com etapa "primeiro contato"', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, empresa: 'ACME', contato_nome: 'Ana' })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ mensagemId: '<m1@acme>' }))

    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })

    expect(r.respostas).toBe(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(store.cancelamentos).toEqual([lead.id])
    expect(g.chamadas).toHaveLength(1)
    expect(g.chamadas[0]).toMatchObject({ organizacaoId: 'org-a', leadId: lead.id, eventoId: 'email:<m1@acme>', empresa: 'ACME', contatoNome: 'Ana', etapaCadencia: 'primeiro contato' })
    const notas = store.interacoes.filter((i) => i.tipo === 'nota')
    expect(notas.some((n) => n.descricao.includes('direcionado a Bruno') && n.descricao.includes('Aviso ao grupo comercial enviado'))).toBe(true)
    // O aviso ao closer (Fluxo 3) vai para o comercial do handoff, não para o
    // responsável antigo do lead.
    const payloads: { responsavelCampanha?: { email?: string } | null }[] = []
    fila.registrar('direcionar_closer', async (p) => { payloads.push(p as typeof payloads[number]) })
    await fila.processar()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].responsavelCampanha?.email).toBe('bruno@a')
  })

  it('2. positivo no FUP 2 → follow-ups 3/4 NÃO saem mais', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const store = new StoreTeste([lead])
    await store.registrarInteracao({ lead_id: lead.id, tipo: 'follow_up', canal: 'email', descricao: 'fup1', origem_acao: 'ia' })
    await store.registrarInteracao({ lead_id: lead.id, tipo: 'follow_up', canal: 'email', descricao: 'fup2', origem_acao: 'ia' })
    await store.atualizarLead(lead.id, { ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const g = gatilhoFake()
    email.injetar(msg())

    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(g.chamadas[0].etapaCadencia).toBe('follow-up 2')

    // Cron de follow-up roda depois: o lead saiu da esteira → nada enviado.
    const fu = await followUp(store, email)
    expect(fu.enviados).toBe(0)
    expect(email.enviados).toHaveLength(0)
    expect(await store.contarInteracoes(lead.id, 'follow_up')).toBe(2)
  })

  it('2b. resposta NEGATIVA: cadência encerra, lead vira PERDIDO (não "interessado"), sem handoff, sem closer', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao: 'follow_up', proxima_acao_data: ONTEM })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ corpo: 'Não temos interesse.' }))

    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('negativo'), handoffProspeccao: g.hook })

    expect(r.respostas).toBe(1)
    const atual = await store.buscarLead(lead.id)
    expect(atual?.estagio).toBe('perdido')
    expect(atual?.perdido).toBe(true)
    expect(atual?.perdido_motivo).toContain('resposta negativa')
    expect(atual?.proxima_acao).toBeNull()
    expect(store.cancelamentos).toEqual([lead.id])
    expect(g.chamadas).toHaveLength(0)          // sem handoff → cursor intocado
    expect(fila.pendentes()).toBe(0)            // sem Fluxo 3 (closer)
    expect(store.interacoes.filter((i) => i.tipo === 'resposta')).toHaveLength(1) // histórico preservado
    expect(store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('marcado como perdido'))).toBe(true)
    // Cron de follow-up depois: nada sai.
    expect((await followUp(store, email)).enviados).toBe(0)
  })

  it('3. resposta NEUTRA: cadência encerra, lead fica "respondeu" (pendente de tratamento), sem handoff, sem closer', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao: 'follow_up', proxima_acao_data: ONTEM })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ corpo: 'Quem é você? Manda mais informações.' }))

    await detectarResposta(store, email, fila, { classificarResposta: classificar('neutro'), handoffProspeccao: g.hook })

    const atual = await store.buscarLead(lead.id)
    expect(atual?.estagio).toBe('respondeu')
    expect(atual?.perdido).toBe(false)
    expect(atual?.proxima_acao).toBeNull()
    expect(store.cancelamentos).toEqual([lead.id])
    expect(g.chamadas).toHaveLength(0)
    expect(fila.pendentes()).toBe(0)
    expect(store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('pendente de tratamento humano'))).toBe(true)
    expect((await followUp(store, email)).enviados).toBe(0)
  })

  it('4. INDETERMINADA (IA fora): cadência encerra, "respondeu", sem handoff, sem closer, revisão manual registrada', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, {
      classificarResposta: async () => ({ classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA não configurada' }),
      handoffProspeccao: g.hook,
    })
    const atual = await store.buscarLead(lead.id)
    expect(atual?.estagio).toBe('respondeu')
    expect(store.cancelamentos).toEqual([lead.id])
    expect(g.chamadas).toHaveLength(0)
    expect(fila.pendentes()).toBe(0)
    expect(store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('revisar manualmente'))).toBe(true)
    expect((await followUp(store, email)).enviados).toBe(0)
  })

  it('lead pendente de tratamento ("respondeu") que responde de novo é reclassificado: positivo → interessado + handoff', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ mensagemId: '<neutra@acme>', corpo: 'Quem é você?' }))
    await detectarResposta(store, email, fila, { classificarResposta: classificar('neutro'), handoffProspeccao: g.hook })
    expect((await store.buscarLead(lead.id))?.estagio).toBe('respondeu')

    const email2 = new SimulatedProvider(); const fila2 = new Queue()
    email2.injetar(msg({ mensagemId: '<positiva@acme>', corpo: 'Ah, agora entendi. Tenho interesse!', em: new Date(Date.now() + 1000) }))
    const r = await detectarResposta(store, email2, fila2, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(r.respostas).toBe(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(g.chamadas).toHaveLength(1)
    expect(g.chamadas[0].eventoId).toBe('email:<positiva@acme>')
    expect(fila2.pendentes()).toBe(1)
  })

  it('retomada de aviso pendente (proxima_acao=aguardando_closer) NÃO reclassifica: segue como positiva', async () => {
    const lead = makeLead({ estagio: 'interessado', proxima_acao: 'aguardando_closer', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    let classificou = 0
    email.injetar(msg())
    await detectarResposta(store, email, fila, {
      classificarResposta: async () => { classificou++; return { classificacao: 'neutro', via: 'ia' } },
      handoffProspeccao: g.hook,
    })
    expect(classificou).toBe(0)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(g.chamadas).toHaveLength(1) // handoff idempotente pelo eventoId
    expect(fila.pendentes()).toBe(1)
  })

  it('7. o MESMO evento processado de novo (mensagem liberada) usa o mesmo eventoId e não muda o lead', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ mensagemId: '<dup@acme>' }))
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(g.chamadas).toHaveLength(1)

    // Falha transitória depois do handoff: a mensagem é liberada e relida na próxima passada.
    await store.liberarMensagem('<dup@acme>')
    const email2 = new SimulatedProvider(); const fila2 = new Queue()
    email2.injetar(msg({ mensagemId: '<dup@acme>' }))
    const r = await detectarResposta(store, email2, fila2, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    // Retomada (aviso ao closer ainda pendente): NÃO registra 2ª resposta nem
    // reclassifica; o gatilho é chamado de novo com o MESMO eventoId — e é ele
    // (Fase 1) que devolve 'ja_processado' sem consumir outro turno.
    expect(r.respostas).toBe(0)
    expect(g.chamadas).toHaveLength(2)
    expect(g.chamadas[1].eventoId).toBe(g.chamadas[0].eventoId)
    expect(store.interacoes.filter((i) => i.tipo === 'resposta')).toHaveLength(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
  })

  it('9. sem comercial (aguardando distribuição): cadência encerrada, nota registrada, closer segue o fluxo antigo', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    const g = gatilhoFake('aguardando')
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(store.cancelamentos).toEqual([lead.id])
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('aguardando distribuição'))).toBe(true)
    // Sem comercial atribuído, o Fluxo 3 avisa quem já avisava (responsável do lead/fallback).
    expect(fila.pendentes()).toBe(1)
    expect((await followUp(store, email)).enviados).toBe(0)
  })

  it('sem os hooks (scripts/testes antigos) o motor se comporta exatamente como antes', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    email.injetar(msg({ corpo: 'Não temos interesse.' }))
    const r = await detectarResposta(store, email, fila)
    expect(r.respostas).toBe(1)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(store.cancelamentos).toEqual([lead.id])
    expect(fila.pendentes()).toBe(1)
  })
})

describe('origem da resposta — só prospecção entra no handoff', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => { email = new SimulatedProvider(); fila = new Queue() })

  it('respostaVemDeProspeccao: campanha tem precedência sobre o estágio', () => {
    expect(respostaVemDeProspeccao(true, null, false)).toBe(true)                       // cadência legada = prospecção
    expect(respostaVemDeProspeccao(false, contextoCampanha('prospeccao'), false)).toBe(true)
    expect(respostaVemDeProspeccao(true, contextoCampanha('followup'), false)).toBe(false) // importado só p/ follow-up
    expect(respostaVemDeProspeccao(false, contextoCampanha('renovacao'), false)).toBe(false)
    expect(respostaVemDeProspeccao(false, contextoCampanha('novidade_clientes'), false)).toBe(false)
    expect(respostaVemDeProspeccao(false, contextoCampanha('followup', 'handoff_retorno:h1'), false)).toBe(true) // Fase 4
    expect(respostaVemDeProspeccao(false, null, true)).toBe(true)                        // retomada/pendente sem campanha
    expect(respostaVemDeProspeccao(false, null, false)).toBe(false)
  })

  it('descreverEtapaCadencia', () => {
    expect(descreverEtapaCadencia(0, null, true)).toBe('primeiro contato')
    expect(descreverEtapaCadencia(3, null, true)).toBe('follow-up 3')
    expect(descreverEtapaCadencia(1, contextoCampanha('prospeccao'), false)).toBe('campanha "Campanha X"')
    expect(descreverEtapaCadencia(1, contextoCampanha('followup', 'handoff_retorno:h1'), true)).toBe('follow-up de retorno')
  })

  it('14. lead de campanha de FOLLOW-UP (importado só para automação) responde positivo → SEM handoff, fluxo antigo', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = contextoCampanha('followup')
    const g = gatilhoFake()
    email.injetar(msg())
    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(r.respostas).toBe(1)
    expect(g.chamadas).toHaveLength(0)
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(store.cancelamentos).toEqual([lead.id])
    expect(fila.pendentes()).toBe(1)
  })

  // Modo carteira: base importada com responsável por lead (HubSpot). A campanha
  // de follow-up não tem rodízio (teste 14), então quem decide o destino é o
  // próprio lead — o responsável fixo vira fallback dentro do Fluxo 3.
  it('15. campanha no modo carteira → o Fluxo 3 recebe a ordem invertida (responsável do lead na frente)', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = { ...contextoCampanha('followup'), retornoParaResponsavelDoLead: true }
    email.injetar(msg())
    await detectarResposta(store, email, fila)
    const payloads: { preferirResponsavelDoLead?: boolean }[] = []
    fila.registrar('direcionar_closer', async (p) => { payloads.push(p as typeof payloads[number]) })
    await fila.processar()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].preferirResponsavelDoLead).toBe(true)
  })

  it('16. campanha legada (sem o campo) mantém o responsável fixo na frente', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = contextoCampanha('followup')
    email.injetar(msg())
    await detectarResposta(store, email, fila)
    const payloads: { preferirResponsavelDoLead?: boolean }[] = []
    fila.registrar('direcionar_closer', async (p) => { payloads.push(p as typeof payloads[number]) })
    await fila.processar()
    expect(payloads[0].preferirResponsavelDoLead).toBe(false)
  })

  // Prioridade do rodízio é absoluta: o handoff acabou de gravar
  // leads.responsavel_id, e reordenar aqui só duplicaria a mesma leitura.
  it('17. handoff atribuiu comercial → o modo carteira NÃO reordena o Fluxo 3', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = { ...contextoCampanha('prospeccao'), retornoParaResponsavelDoLead: true }
    const g = gatilhoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    const payloads: { preferirResponsavelDoLead?: boolean; responsavelCampanha?: { email?: string } | null }[] = []
    fila.registrar('direcionar_closer', async (p) => { payloads.push(p as typeof payloads[number]) })
    await fila.processar()
    expect(payloads[0].preferirResponsavelDoLead).toBe(false)
    expect(payloads[0].responsavelCampanha?.email).toBe('bruno@a')
  })

  // Rodízio DESLIGADO na organização: o motor não monta o gatilho, então
  // nenhum handoff nasce. A classificação NÃO depende disso — continua
  // separando positivo/negativo/neutro.
  it('18. rodízio desligado: resposta NEGATIVA de prospecção ainda marca o lead como perdido', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = contextoCampanha('prospeccao')
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('negativo') })
    const atualizado = await store.buscarLead(lead.id)
    expect(atualizado?.estagio).toBe('perdido')
    expect(atualizado?.perdido).toBe(true)
    // Sem gatilho não há handoff — logo, nada de "aguardando distribuição".
    expect(store.interacoes.some((i) => i.descricao.includes('Handoff comercial'))).toBe(false)
  })

  it('19. rodízio desligado: resposta POSITIVA segue para o closer, sem handoff nem nota de distribuição', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = contextoCampanha('prospeccao')
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo') })
    expect((await store.buscarLead(lead.id))?.estagio).toBe('interessado')
    expect(fila.pendentes()).toBe(1)
    expect(store.interacoes.some((i) => i.descricao.includes('aguardando distribuição'))).toBe(false)
  })

  it('lead de campanha de PROSPECÇÃO (fora da cadência legada) responde positivo → handoff com etapa da campanha', async () => {
    const lead = makeLead({ estagio: 'novos_leads', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    store.contexto = contextoCampanha('prospeccao')
    const g = gatilhoFake()
    email.injetar(msg())
    await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(g.chamadas).toHaveLength(1)
    expect(g.chamadas[0].etapaCadencia).toBe('campanha "Campanha X"')
  })

  it('13. lead de OUTRA organização nunca chega ao gatilho (o store é preso à org: a resposta não casa)', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'outra@empresa.com.br', ultimo_contato: SEMANA_PASSADA })
    const store = new StoreTeste([lead])
    const g = gatilhoFake()
    email.injetar(msg({ de: 'ana@acme.com.br' })) // e-mail que não pertence a nenhum lead desta org
    const r = await detectarResposta(store, email, fila, { classificarResposta: classificar('positivo'), handoffProspeccao: g.hook })
    expect(r.respostas).toBe(0)
    expect(g.chamadas).toHaveLength(0)
    expect(store.cancelamentos).toHaveLength(0)
  })
})
