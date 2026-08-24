import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DIAS_FOLLOWUPS_PADRAO } from '../config'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { executarAcao } from '../flows/executarAcao'
import { detectarResposta, ehAutoResposta, MARCADOR_CONTATO_ALT } from '../flows/detectarResposta'
import { direcionarCloser } from '../flows/direcionarCloser'
import { followUp } from '../flows/followUp'
import type { MensagemRecebida } from '../types'
import type { EmailProvider } from '../email/provider'
import { makeLead, ONTEM, SEMANA_PASSADA, AMANHA } from './helpers'

function msg(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: over.de ?? 'fulano@empresa.com.br',
    assunto: over.assunto ?? 'Re: proposta',
    corpo: over.corpo ?? 'Tenho interesse, podemos conversar?',
    automatica: over.automatica,
    em: over.em ?? new Date(),
  }
}

describe('Fluxo 1 — executarAcao', () => {
  let email: SimulatedProvider
  beforeEach(() => {
    email = new SimulatedProvider()
  })

  it('envia primeiro contato e avança o estágio', async () => {
    const lead = makeLead({ estagio: 'novos_leads', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    const r = await executarAcao(store, email, { leadId: lead.id })
    expect(r.ok).toBe(true)
    expect(r.estagio).toBe('primeiro_contato')
    expect(email.enviados).toHaveLength(1)
    expect(email.enviados[0].para).toBe('ana@acme.com.br')
    expect(await store.contarInteracoes(lead.id, 'abordagem')).toBe(1)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('primeiro_contato')
  })

  it('IDEMPOTÊNCIA: não reenvia o primeiro contato', async () => {
    const lead = makeLead({ estagio: 'novos_leads' })
    const store = new MemoryStore([lead])
    await executarAcao(store, email, { leadId: lead.id })
    // Volta o estágio à força para tentar burlar — ainda assim não reenvia,
    // porque a checagem é pela interação já registrada (não pelo estágio).
    await store.atualizarLead(lead.id, { estagio: 'novos_leads' })
    const r2 = await executarAcao(store, email, { leadId: lead.id })
    expect(r2.ok).toBe(false)
    expect(r2.motivo).toBe('ja_enviado')
    expect(email.enviados).toHaveLength(1)
  })

  it('TRAVA owner: ignora lead que não é do motor', async () => {
    const lead = makeLead({ owner: 'n8n', estagio: 'novos_leads' })
    const store = new MemoryStore([lead])
    const r = await executarAcao(store, email, { leadId: lead.id })
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('owner_nao_engine')
    expect(email.enviados).toHaveLength(0)
  })

  it('LIMITE DIÁRIO: não envia quando o teto do dia foi atingido', async () => {
    // MAX_ENVIOS_DIA=2 (setup). Pré-carrega 2 envios de hoje.
    const usado = makeLead({ estagio: 'follow_up' })
    const alvo = makeLead({ estagio: 'novos_leads' })
    const store = new MemoryStore([usado, alvo])
    await store.registrarInteracao({ lead_id: usado.id, tipo: 'abordagem', canal: 'email', descricao: 'x', origem_acao: 'ia' })
    await store.registrarInteracao({ lead_id: usado.id, tipo: 'follow_up', canal: 'email', descricao: 'x', origem_acao: 'ia' })
    expect(await store.enviosHoje()).toBe(2)
    const r = await executarAcao(store, email, { leadId: alvo.id })
    expect(r.ok).toBe(false)
    expect(r.motivo).toBe('limite_diario')
    expect(email.enviados).toHaveLength(0)
  })
})

describe('Fluxo 2 — detectarResposta', () => {
  let email: SimulatedProvider
  let fila: Queue
  beforeEach(() => {
    email = new SimulatedProvider()
    fila = new Queue()
  })

  it('AUTO-RESPOSTA ignorada (flag e heurística)', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    email.injetar(
      msg({ de: 'ana@acme.com.br', automatica: true }),
      msg({ de: 'ana@acme.com.br', assunto: 'Fora do escritório (Out of Office)', automatica: false }),
      msg({ de: 'mailer-daemon@acme.com.br', assunto: 'Undeliverable: proposta' }),
    )
    const r = await detectarResposta(store, email, fila)
    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(3)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('follow_up') // não pausou
    expect(fila.pendentes()).toBe(0)

    // sanity da heurística pura
    expect(ehAutoResposta(msg({ assunto: 'Resposta automática de férias' }))).toBe(true)
    expect(ehAutoResposta(msg({ assunto: 'Re: proposta', corpo: 'topo!' }))).toBe(false)
  })

  it('ITEM 7: auto-reply de ausência → registra sugestão de contato alternativo', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    email.injetar(
      msg({
        de: 'ana@acme.com.br',
        assunto: 'Estou de férias',
        corpo: 'Estarei ausente. Na minha ausência, falar com Beltrano (beltrano@acme.com.br).',
        automatica: true,
      }),
    )
    // Extrator fake (no lugar da IA): devolve o contato alternativo do corpo.
    const extrairContatos = vi.fn(async () => [{ nome: 'Beltrano', email: 'beltrano@acme.com.br' }])

    const r = await detectarResposta(store, email, fila, { extrairContatos })

    expect(extrairContatos).toHaveBeenCalledOnce()
    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(1) // segue contando como ignorada p/ o fluxo de resposta
    expect(r.contatosAlternativos).toBe(1)
    // Não pausou a cadência nem virou "interessado".
    expect((await store.buscarLead(lead.id))!.estagio).toBe('follow_up')
    expect(fila.pendentes()).toBe(0)
    // Registrou UMA nota de sugestão, com o marcador e o contato no texto.
    const notas = store.interacoes.filter((i) => i.lead_id === lead.id && i.tipo === 'nota')
    expect(notas).toHaveLength(1)
    expect(notas[0].descricao.startsWith(MARCADOR_CONTATO_ALT)).toBe(true)
    expect(notas[0].descricao).toContain('beltrano@acme.com.br')
    expect(notas[0].origem_acao).toBe('ia')
  })

  it('ITEM 7: sem contato alternativo no corpo → não registra nota', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    email.injetar(msg({ de: 'ana@acme.com.br', assunto: 'Out of office', automatica: true }))
    const extrairContatos = vi.fn(async () => []) // IA não achou ninguém

    const r = await detectarResposta(store, email, fila, { extrairContatos })

    expect(r.contatosAlternativos).toBe(0)
    expect(r.ignoradas).toBe(1)
    expect(store.interacoes.filter((i) => i.tipo === 'nota')).toHaveLength(0)
  })

  it('CASAMENTO POR DOMÍNIO (resposta encaminhada)', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    // Quem responde é o CHEFE, e-mail diferente, mesmo domínio.
    email.injetar(msg({ de: 'diretor@acme.com.br', corpo: 'A Ana me encaminhou, vamos conversar.' }))
    const r = await detectarResposta(store, email, fila)
    expect(r.respostas).toBe(1)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('interessado')
    expect(fila.pendentes()).toBe(1)
  })

  it('CASAMENTO POR DOMÍNIO usa a coluna dominio quando o e-mail é pessoal', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@gmail.com', dominio: 'acme.com.br' })
    const store = new MemoryStore([lead])
    email.injetar(msg({ de: 'diretor@acme.com.br' }))
    const r = await detectarResposta(store, email, fila)
    expect(r.respostas).toBe(1)
  })

  it('PAUSA ao responder: lead sai da esteira de follow-up', async () => {
    const lead = makeLead({
      estagio: 'follow_up',
      contato_email: 'ana@acme.com.br',
      proxima_acao_data: ONTEM, // estaria elegível para follow-up
    })
    const store = new MemoryStore([lead])
    const cancelarWorkflows = vi.spyOn(store, 'cancelarExecucoesWorkflow')
    // Antes: elegível.
    expect(await store.leadsParaFollowup()).toHaveLength(1)
    email.injetar(msg({ de: 'ana@acme.com.br' }))
    await detectarResposta(store, email, fila)
    // Depois: pausado (interessado) → não entra mais no follow-up.
    expect((await store.buscarLead(lead.id))!.estagio).toBe('interessado')
    expect(await store.leadsParaFollowup()).toHaveLength(0)
    expect(await store.contarInteracoes(lead.id, 'resposta')).toBe(1)
    expect(cancelarWorkflows).toHaveBeenCalledWith(lead.id)
  })

  it('só confirma a leitura depois de persistir a resposta', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    const recebida = msg({ de: 'ana@acme.com.br', idRecebimento: 'INBOX:1' })
    const confirmarLeitura = vi.fn().mockResolvedValue(undefined)
    const provider: EmailProvider = {
      enviar: vi.fn().mockResolvedValue(undefined),
      lerCaixaEntrada: vi.fn().mockResolvedValue([recebida]),
      confirmarLeitura,
    }

    await detectarResposta(store, provider, fila)

    expect(await store.contarInteracoes(lead.id, 'resposta')).toBe(1)
    expect(confirmarLeitura).toHaveBeenCalledWith([recebida])
  })

  it('não confirma a leitura quando o registro da resposta falha', async () => {
    const lead = makeLead({ estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    vi.spyOn(store, 'registrarInteracao').mockRejectedValueOnce(new Error('banco indisponível'))
    const confirmarLeitura = vi.fn().mockResolvedValue(undefined)
    const provider: EmailProvider = {
      enviar: vi.fn().mockResolvedValue(undefined),
      lerCaixaEntrada: vi.fn().mockResolvedValue([msg({ de: 'ana@acme.com.br' })]),
      confirmarLeitura,
    }

    await expect(detectarResposta(store, provider, fila)).rejects.toThrow('banco indisponível')

    expect(confirmarLeitura).not.toHaveBeenCalled()
    expect((await store.buscarLead(lead.id))?.estagio).toBe('follow_up')
  })

  it('retoma a notificação pendente sem duplicar a interação de resposta', async () => {
    const lead = makeLead({
      estagio: 'interessado',
      proxima_acao: 'aguardando_closer',
      contato_email: 'ana@acme.com.br',
    })
    const store = new MemoryStore([lead])
    const registrar = vi.spyOn(store, 'registrarInteracao')

    const resultado = await detectarResposta(store, email, fila)
    expect(resultado.respostas).toBe(0)
    expect(fila.pendentes()).toBe(0)

    email.injetar(msg({ de: 'ana@acme.com.br' }))
    await detectarResposta(store, email, fila)

    expect(registrar).not.toHaveBeenCalled()
    expect(fila.pendentes()).toBe(1)
  })

  it('não casa com lead de outro owner (n8n)', async () => {
    const lead = makeLead({ owner: 'n8n', estagio: 'follow_up', contato_email: 'ana@acme.com.br' })
    const store = new MemoryStore([lead])
    email.injetar(msg({ de: 'ana@acme.com.br' }))
    const r = await detectarResposta(store, email, fila)
    expect(r.respostas).toBe(0)
  })
})

describe('Fluxo 3 — direcionarCloser', () => {
  it('prioriza o responsável configurado na campanha ativa', async () => {
    const lead = makeLead({ estagio: 'interessado', responsavel_id: 'responsavel-do-lead' })
    const store = new MemoryStore([lead], [{ id: 'responsavel-do-lead', nome: 'Responsável antigo', email: 'antigo@empresa.com' }])
    const email = new SimulatedProvider()
    const r = await direcionarCloser(store, email, {
      leadId: lead.id,
      textoResposta: 'Tenho interesse.',
      responsavelCampanha: { id: 'perfil-campanha', nome: 'Dona da campanha', email: 'campanha@empresa.com' },
    })
    expect(r.closer).toBe('campanha@empresa.com')
    expect(email.enviados[0].para).toBe('campanha@empresa.com')
  })

  it('notifica o responsável com contexto completo e marca com_closer', async () => {
    const closer = { id: 'u1', nome: 'João Closer', email: 'joao@inovacode.com.br' }
    const lead = makeLead({
      estagio: 'interessado',
      responsavel_id: 'u1',
      segmento: 'Petróleo',
      tese_comercial: 'rastreamento de EPIs reduz perdas em 4%',
      ultimo_contato: ONTEM,
    })
    const store = new MemoryStore([lead], [closer])
    const email = new SimulatedProvider()
    const r = await direcionarCloser(store, email, { leadId: lead.id, textoResposta: 'Quero saber mais.' })
    expect(r.ok).toBe(true)
    expect(r.closer).toBe('joao@inovacode.com.br')
    expect(email.enviados[0].para).toBe('joao@inovacode.com.br')
    expect(email.enviados[0].corpo).toContain('Petróleo')
    expect(email.enviados[0].corpo).toContain('rastreamento de EPIs')
    expect(email.enviados[0].corpo).toContain('Quero saber mais.')
    expect((await store.buscarLead(lead.id))!.proxima_acao).toBe('com_closer')
  })

  it('materializa o modelo editável da campanha com o objetivo e a resposta reais', async () => {
    const responsavel = { id: 'u1', nome: 'Maria', email: 'maria@empresa.com' }
    const lead = makeLead({ responsavel_id: 'u1', empresa: 'Acme', contato_nome: 'Ana', segmento: '' })
    const store = new MemoryStore([lead], [responsavel])
    const email = new SimulatedProvider()

    await direcionarCloser(store, email, {
      leadId: lead.id,
      textoResposta: 'Quero renovar.',
      responsavelCampanha: responsavel,
      contextoCampanha: {
        id: 'camp-1',
        nome: 'Renovação 2026',
        tipo: 'renovacao',
        responsavel,
        notificarResponsavel: true,
        emailAssunto: 'Resposta de {empresa} — {tipo_campanha}',
        emailCorpo: '{campanha}\n{contato}\n{nicho}\n{resposta}\n{responsavel}',
        emailHtml: '<p><strong>{empresa}</strong>: {resposta}</p>',
      },
    })

    expect(email.enviados[0].assunto).toBe('Resposta de Acme — Comunicar renovação')
    expect(email.enviados[0].corpo).toContain('Renovação 2026')
    expect(email.enviados[0].corpo).toContain('Quero renovar.')
    expect(email.enviados[0].corpo).toContain('Maria')
    expect(email.enviados[0].html).toContain('<strong>Acme</strong>: Quero renovar.')
  })

  it('usa o fallback CLOSER_EMAIL quando o lead não tem responsável', async () => {
    const lead = makeLead({ estagio: 'interessado', responsavel_id: undefined })
    const store = new MemoryStore([lead])
    const email = new SimulatedProvider()
    const r = await direcionarCloser(store, email, { leadId: lead.id, textoResposta: 'oi' })
    expect(r.closer).toBe('closer@inovacode.com.br')
  })
})

describe('Fluxo 4 — followUp', () => {
  let email: SimulatedProvider
  beforeEach(() => {
    email = new SimulatedProvider()
  })

  it('envia follow-up para lead elegível e avança', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', proxima_acao_data: ONTEM })
    const store = new MemoryStore([lead])
    const r = await followUp(store, email)
    expect(r.enviados).toBe(1)
    expect(email.enviados).toHaveLength(1)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('follow_up')
    expect(await store.contarInteracoes(lead.id, 'follow_up')).toBe(1)
  })

  it('respeita o tempo de espera (não envia antes da hora)', async () => {
    const lead = makeLead({ estagio: 'follow_up', proxima_acao_data: AMANHA })
    const store = new MemoryStore([lead])
    const r = await followUp(store, email)
    expect(r.enviados).toBe(0)
  })

  it('CC do responsável: com responsavel_id real, o follow-up vai com o comercial em cópia', async () => {
    const closer = { id: 'u1', nome: 'Francisco', email: 'fran@inovacode.com.br' }
    const lead = makeLead({ estagio: 'primeiro_contato', proxima_acao_data: ONTEM, responsavel_id: 'u1' })
    const store = new MemoryStore([lead], [closer])
    const r = await followUp(store, email)
    expect(r.enviados).toBe(1)
    expect(email.enviados[0].cc).toBe('fran@inovacode.com.br')
  })

  it('lead legado (sem responsavel_id): follow-up vai SEM cc, sem quebrar', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', proxima_acao_data: ONTEM, responsavel_id: undefined })
    const store = new MemoryStore([lead])
    const r = await followUp(store, email)
    expect(r.enviados).toBe(1)
    expect(email.enviados[0].cc).toBeUndefined()
  })

  it('NÃO-REENVIO: respeita o máximo de follow-ups (8)', async () => {
    const lead = makeLead({ estagio: 'follow_up', proxima_acao_data: ONTEM })
    const store = new MemoryStore([lead])
    for (let i = 0; i < 8; i++) {
      await store.registrarInteracao({ lead_id: lead.id, tipo: 'follow_up', canal: 'email', descricao: 'x', origem_acao: 'ia' })
    }
    const r = await followUp(store, email)
    expect(r.enviados).toBe(0)
    expect(email.enviados).toHaveLength(0)
  })

  it('quem já respondeu (interessado) NUNCA entra no follow-up', async () => {
    const lead = makeLead({ estagio: 'interessado', proxima_acao_data: ONTEM })
    const store = new MemoryStore([lead])
    const r = await followUp(store, email)
    expect(r.elegiveis).toBe(0)
  })

  it('SAÍDA AUTOMÁTICA: esgotou os follow-ups + tempo vencido → sem_resposta', async () => {
    const lead = makeLead({ estagio: 'follow_up', proxima_acao_data: ONTEM })
    const store = new MemoryStore([lead])
    for (let i = 0; i < 8; i++) {
      await store.registrarInteracao({ lead_id: lead.id, tipo: 'follow_up', canal: 'email', descricao: 'x', origem_acao: 'ia' })
    }
    const r = await followUp(store, email)
    expect(r.encerrados).toBe(1)
    expect(r.enviados).toBe(0)
    expect(email.enviados).toHaveLength(0)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('sem_resposta')
  })

  it('NÃO encerra antes de esgotar ou se o tempo não venceu', async () => {
    // Esgotou os 8, mas o tempo ainda não venceu (proxima_acao_data no futuro).
    const lead = makeLead({ estagio: 'follow_up', proxima_acao_data: AMANHA })
    const store = new MemoryStore([lead])
    for (let i = 0; i < 8; i++) {
      await store.registrarInteracao({ lead_id: lead.id, tipo: 'follow_up', canal: 'email', descricao: 'x', origem_acao: 'ia' })
    }
    const r = await followUp(store, email)
    expect(r.encerrados).toBe(0)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('follow_up')
  })

  it('LIMITE DIÁRIO trava o lote de follow-ups', async () => {
    // MAX_ENVIOS_DIA=2. Três leads elegíveis → só 2 saem hoje.
    const leads = [1, 2, 3].map((n) =>
      makeLead({ id: `fu-${n}`, estagio: 'follow_up', proxima_acao_data: SEMANA_PASSADA }),
    )
    const store = new MemoryStore(leads)
    const r = await followUp(store, email)
    expect(r.enviados).toBe(2)
    expect(email.enviados).toHaveLength(2)
  })
})

// CRITÉRIO DE ACEITE do item 3: um lead simulado passa pelas 8 etapas NOS DIAS
// CERTOS (3/7/14/30/60/90/120/180 a partir do 1º contato) e sai para
// 'sem_resposta' depois do 8º sem resposta. Usa fake timers p/ avançar o relógio
// até cada data-alvo — como cada follow-up cai num dia diferente, o limite
// diário (2) não interfere.
describe('Fluxo 4 — cadência 3/7/14/30/60/90/120/180 (item 3)', () => {
  afterEach(() => vi.useRealTimers())

  it('envia os 8 follow-ups nos dias certos e encerra em sem_resposta', async () => {
    const T0 = new Date('2026-01-01T09:00:00Z') // "1º contato"
    vi.useFakeTimers()
    vi.setSystemTime(T0)

    // Estado logo após o 1º contato: 1º follow-up agendado para T0 + 3 dias.
    const primeiroAlvo = new Date(T0.getTime() + DIAS_FOLLOWUPS_PADRAO[0] * 86_400_000)
    const lead = makeLead({
      estagio: 'follow_up',
      followups_enviados: 0,
      ultimo_contato: T0.toISOString(),
      proxima_acao_data: primeiroAlvo.toISOString(),
    })
    const store = new MemoryStore([lead])
    const email = new SimulatedProvider()

    for (let k = 0; k < DIAS_FOLLOWUPS_PADRAO.length; k++) {
      // Avança o relógio para logo depois da data-alvo do follow-up nº k+1.
      vi.setSystemTime(new Date(T0.getTime() + DIAS_FOLLOWUPS_PADRAO[k] * 86_400_000 + 3_600_000))
      const r = await followUp(store, email)
      expect(r.enviados).toBe(1)
      expect(await store.contarInteracoes(lead.id, 'follow_up')).toBe(k + 1)

      const atual = (await store.buscarLead(lead.id))!
      if (k < DIAS_FOLLOWUPS_PADRAO.length - 1) {
        // Próximo alvo = T0 + dias[k+1] EXATO (ancorado, sem drift pelo +1h).
        const esperado = new Date(T0.getTime() + DIAS_FOLLOWUPS_PADRAO[k + 1] * 86_400_000)
        expect(atual.proxima_acao_data).toBe(esperado.toISOString())
      }
    }

    // 8 enviados; nenhum a mais. Passado o tempo, encerra em sem_resposta.
    expect(await store.contarInteracoes(lead.id, 'follow_up')).toBe(8)
    vi.setSystemTime(new Date(T0.getTime() + 200 * 86_400_000))
    const fim = await followUp(store, email)
    expect(fim.enviados).toBe(0)
    expect(fim.encerrados).toBe(1)
    expect((await store.buscarLead(lead.id))!.estagio).toBe('sem_resposta')
  })
})

describe('Fila — retry + escaninho de erro (dead-letter)', () => {
  it('manda para o dead-letter após estourar as tentativas', async () => {
    const fila = new Queue(3)
    let chamadas = 0
    fila.registrar('quebra', async () => {
      chamadas++
      throw new Error('falha proposital')
    })
    fila.enfileirar('quebra', { x: 1 })
    await fila.processar()
    expect(chamadas).toBe(3)
    expect(fila.escaninhoErro()).toHaveLength(1)
    expect(fila.escaninhoErro()[0].ultimoErro).toContain('falha proposital')
  })

  it('reprocessa e tem sucesso na 2ª tentativa (retry)', async () => {
    const fila = new Queue(3)
    let chamadas = 0
    fila.registrar('instavel', async () => {
      chamadas++
      if (chamadas < 2) throw new Error('tente de novo')
    })
    fila.enfileirar('instavel')
    await fila.processar()
    expect(chamadas).toBe(2)
    expect(fila.escaninhoErro()).toHaveLength(0)
  })
})

describe('Integração — detectar → fila → closer (Fluxo 2+3)', () => {
  it('detecta resposta, processa a fila e avisa o closer', async () => {
    const closer = { id: 'u1', nome: 'João', email: 'joao@inovacode.com.br' }
    const lead = makeLead({
      estagio: 'follow_up',
      contato_email: 'ana@acme.com.br',
      responsavel_id: 'u1',
      proxima_acao_data: ONTEM,
    })
    const store = new MemoryStore([lead], [closer])
    const email = new SimulatedProvider()
    const fila = new Queue()
    fila.registrar('direcionar_closer', (p) =>
      direcionarCloser(store, email, p as { leadId: string; textoResposta: string }),
    )
    email.injetar(msg({ de: 'ana@acme.com.br', corpo: 'Topo a conversa!' }))

    await detectarResposta(store, email, fila)
    await fila.processar()

    expect(email.enviados.some((e) => e.para === 'joao@inovacode.com.br')).toBe(true)
    expect((await store.buscarLead(lead.id))!.proxima_acao).toBe('com_closer')
    expect(fila.escaninhoErro()).toHaveLength(0)
  })
})
