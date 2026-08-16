import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { SimulatedProvider } from '../email/simulatedProvider'
import { Queue } from '../queue'
import { detectarResposta, ehBounce } from '../flows/detectarResposta'
import type { MensagemRecebida } from '../types'
import { makeLead, SEMANA_PASSADA } from './helpers'

function msgBounce(over: Partial<MensagemRecebida> = {}): MensagemRecebida {
  return {
    de: over.de ?? 'mailer-daemon@smtp.empresa.com.br',
    assunto: over.assunto ?? 'Undeliverable: Proposta comercial',
    corpo: over.corpo ?? 'Your message to contato@acme.com.br could not be delivered.',
    automatica: over.automatica ?? true,
    em: over.em ?? new Date(),
  }
}

describe('ehBounce', () => {
  it('detecta mailer-daemon pelo remetente', () => {
    expect(ehBounce(msgBounce({ de: 'mailer-daemon@smtp.example.com' }))).toBe(true)
  })
  it('detecta postmaster pelo remetente', () => {
    expect(ehBounce(msgBounce({ de: 'postmaster@example.com' }))).toBe(true)
  })
  it('detecta "Undeliverable" no assunto', () => {
    expect(ehBounce(msgBounce({ de: 'noreply@example.com', assunto: 'Undeliverable: Re: proposta' }))).toBe(true)
  })
  it('detecta "Delivery Status Notification" no assunto', () => {
    expect(ehBounce(msgBounce({ de: 'noreply@example.com', assunto: 'Delivery Status Notification (Failure)' }))).toBe(true)
  })
  it('NÃO confunde out-of-office com bounce', () => {
    expect(ehBounce({ de: 'ana@empresa.com', assunto: 'Out of office: férias', corpo: '', automatica: true, em: new Date() })).toBe(false)
  })
  it('NÃO confunde auto-reply genérico com bounce', () => {
    expect(ehBounce({ de: 'noreply@sistema.com', assunto: 'Automatic reply: sua mensagem foi recebida', corpo: '', automatica: true, em: new Date() })).toBe(false)
  })
})

describe('detectarResposta — bounce handling', () => {
  let store: MemoryStore
  let email: SimulatedProvider
  let fila: Queue

  beforeEach(() => {
    email = new SimulatedProvider()
    fila = new Queue()
  })

  it('marca lead como bounced e cancela cadência', async () => {
    const lead = makeLead({
      estagio: 'primeiro_contato',
      contato_email: 'contato@acme.com.br',
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])

    email.injetar(msgBounce({
      de: 'mailer-daemon@smtp.empresa.com.br',
      assunto: 'Undeliverable: proposta',
      corpo: 'Your message to contato@acme.com.br could not be delivered. 550 User not found.',
    }))

    const r = await detectarResposta(store, email, fila)

    const leadAtualizado = await store.buscarLead(lead.id)
    expect(leadAtualizado?.bounced).toBe(true)
    expect(leadAtualizado?.bounced_em).not.toBeNull()
    expect(leadAtualizado?.proxima_acao).toBeNull()
    expect(leadAtualizado?.proxima_acao_data).toBeNull()

    const nota = store.interacoes.find((i) => i.lead_id === lead.id && i.tipo === 'nota')
    expect(nota?.descricao).toContain('Bounce SMTP detectado')

    expect(r.bounces).toBe(1)
    expect(r.respostas).toBe(0)
    expect(r.ignoradas).toBe(1) // bounce conta em ignoradas
    expect(fila.pendentes()).toBe(0)
  })

  it('lead bounced não entra em leadsParaFollowup', async () => {
    const lead = makeLead({
      estagio: 'primeiro_contato',
      bounced: true,
      bounced_em: new Date().toISOString(),
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])

    const elegiveis = await store.leadsParaFollowup()
    expect(elegiveis).toHaveLength(0)
  })

  it('lead bounced não entra em leadsEsgotadosSemResposta', async () => {
    const lead = makeLead({
      estagio: 'follow_up',
      bounced: true,
      ultimo_contato: SEMANA_PASSADA,
    })
    store = new MemoryStore([lead])
    // Simula que todos os follow-ups foram enviados
    for (let i = 0; i < 10; i++) {
      store.interacoes.push({
        id: `int-${i}`,
        lead_id: lead.id,
        tipo: 'follow_up',
        canal: 'email',
        descricao: `Follow-up ${i}`,
        origem_acao: 'ia',
        created_at: SEMANA_PASSADA,
      })
    }
    const esgotados = await store.leadsEsgotadosSemResposta()
    expect(esgotados).toHaveLength(0)
  })

  it('bounce sem lead casado: contabiliza ignorada, não lança erro', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'outro@empresa.com.br' })
    store = new MemoryStore([lead])

    email.injetar(msgBounce({
      de: 'mailer-daemon@servidor.com',
      corpo: 'Message to desconhecido@naoexiste.com could not be delivered.',
    }))

    const r = await detectarResposta(store, email, fila)
    expect(r.bounces).toBe(0)
    expect(r.ignoradas).toBe(1)

    const leadOriginal = await store.buscarLead(lead.id)
    expect(leadOriginal?.bounced).toBe(false)
  })

  it('auto-reply de férias NÃO é tratado como bounce', async () => {
    const lead = makeLead({ estagio: 'primeiro_contato', contato_email: 'ana@empresa.com.br' })
    store = new MemoryStore([lead])

    email.injetar({
      de: 'ana@empresa.com.br',
      assunto: 'Automatic reply: out of office',
      corpo: 'Estarei ausente até dia 20/08.',
      automatica: true,
      em: new Date(),
    })

    const r = await detectarResposta(store, email, fila)
    expect(r.bounces).toBe(0)

    const leadAtualizado = await store.buscarLead(lead.id)
    expect(leadAtualizado?.bounced).toBe(false)
  })
})
