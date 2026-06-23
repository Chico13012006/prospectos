import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { executarAcao } from '../flows/executarAcao'
import { detectarResposta, ehAutoResposta } from '../flows/detectarResposta'
import { direcionarCloser } from '../flows/direcionarCloser'
import { followUp } from '../flows/followUp'
import type { MensagemRecebida } from '../types'
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
    // Antes: elegível.
    expect(await store.leadsParaFollowup()).toHaveLength(1)
    email.injetar(msg({ de: 'ana@acme.com.br' }))
    await detectarResposta(store, email, fila)
    // Depois: pausado (interessado) → não entra mais no follow-up.
    expect((await store.buscarLead(lead.id))!.estagio).toBe('interessado')
    expect(await store.leadsParaFollowup()).toHaveLength(0)
    expect(await store.contarInteracoes(lead.id, 'resposta')).toBe(1)
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

  it('NÃO-REENVIO: respeita o máximo de follow-ups (3)', async () => {
    const lead = makeLead({ estagio: 'follow_up', proxima_acao_data: ONTEM })
    const store = new MemoryStore([lead])
    for (let i = 0; i < 3; i++) {
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
