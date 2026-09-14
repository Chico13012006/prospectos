// Integração em memória do fluxo inteiro: detectarResposta (motor) →
// classificação → gatilho REAL (handoffService + rodízio + outbox). Prova, por
// classificação, o que acontece com estágio, cadência, cursor, handoff e grupo.
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '@/lib/engine/store/memoryStore'
import { SimulatedProvider } from '@/lib/engine/email/simulatedProvider'
import { Queue } from '@/lib/engine/queue'
import { detectarResposta } from '@/lib/engine/flows/detectarResposta'
import { followUp } from '@/lib/engine/flows/followUp'
import type { MensagemRecebida } from '@/lib/engine/types'
import { makeLead, SEMANA_PASSADA, ONTEM } from '@/lib/engine/__tests__/helpers'
import { processarRespostaPositivaProspeccao } from '../gatilhoProspeccao'
import { MemoryHandoffRepository } from './memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import type { ClassificacaoResposta } from '@/lib/comercial/respostas/classificarResposta'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG = 'org-a'
const GRUPO = '120363019502650977-group'

class StoreOrg extends MemoryStore {
  readonly organizacaoId = ORG
  cancelamentos: string[] = []
  async cancelarExecucoesWorkflow(leadId: string) { this.cancelamentos.push(leadId) }
}

function cenario(classificacao: ClassificacaoResposta) {
  const lead = makeLead({ id: 'lead-1', estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM, empresa: 'ACME', contato_nome: 'Ana', responsavel_id: 'sdr' })
  const store = new StoreOrg([lead])
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG, nome: 'Silmara', email: 'silmara@a' })
    .participar(ORG, 'bruno').participar(ORG, 'silmara')
    .addLead({ id: 'lead-1', organizacaoId: ORG, responsavelId: 'sdr' })
  const notif = new MemoryNotificacaoRepository()
  const mensagensGrupo: string[] = []
  const enviar: EnviadorGrupo = async (_g, m) => { mensagensGrupo.push(m); return { ok: true, providerMessageId: 'z1' } }
  const deps = { handoff, notificacoes: { repo: notif, enviar, lerGrupoId: async () => GRUPO } }
  const opts = {
    classificarResposta: async () => ({ classificacao, via: 'ia' as const }),
    handoffProspeccao: (e: Parameters<typeof processarRespostaPositivaProspeccao>[1]) => processarRespostaPositivaProspeccao(deps, e),
  }
  const email = new SimulatedProvider()
  const fila = new Queue()
  const msg = (over: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
    de: 'ana@acme.com.br', assunto: 'Re: proposta', corpo: 'resposta', em: new Date(), mensagemId: '<m1@acme>', ...over,
  })
  return { lead, store, handoff, notif, mensagensGrupo, opts, email, fila, msg }
}

describe('integração — classificação × handoff × rodízio × grupo', () => {
  it('1. POSITIVA: interessado + handoff round-robin + cursor avança + alerta no grupo + closer', async () => {
    const c = cenario('positivo')
    c.email.injetar(c.msg({ corpo: 'Tenho interesse, vamos conversar.' }))
    await detectarResposta(c.store, c.email, c.fila, c.opts)

    expect((await c.store.buscarLead('lead-1'))?.estagio).toBe('interessado')
    expect(c.store.cancelamentos).toEqual(['lead-1'])
    expect(c.handoff.handoffs(ORG)).toHaveLength(1)
    expect(c.handoff.handoffs(ORG)[0]).toMatchObject({ motivo: 'round_robin', status: 'em_contato_comercial', responsavelId: 'bruno' })
    expect(c.handoff.cursor(ORG)).toEqual({ ultimoUsuarioId: 'bruno', versao: 1 })
    expect(c.handoff.lead('lead-1')?.responsavelId).toBe('bruno')
    expect(c.mensagensGrupo).toHaveLength(1)
    expect(c.mensagensGrupo[0]).toContain('NOVO LEAD INTERESSADO')
    expect(c.notif.linhas[0].status).toBe('enviada')
    expect(c.fila.pendentes()).toBe(1)
  })

  for (const [cls, estagio] of [['negativo', 'perdido'], ['neutro', 'respondeu'], ['indeterminado', 'respondeu']] as const) {
    it(`${cls.toUpperCase()}: cadência encerra, estágio '${estagio}', sem handoff, cursor parado, sem grupo, sem closer`, async () => {
      const c = cenario(cls)
      c.email.injetar(c.msg())
      const r = await detectarResposta(c.store, c.email, c.fila, c.opts)

      expect(r.respostas).toBe(1)
      const lead = await c.store.buscarLead('lead-1')
      expect(lead?.estagio).toBe(estagio)
      expect(lead?.perdido).toBe(cls === 'negativo')
      expect(c.store.cancelamentos).toEqual(['lead-1'])
      expect(c.handoff.handoffs(ORG)).toHaveLength(0)
      expect(c.handoff.cursor(ORG)).toEqual({ ultimoUsuarioId: null, versao: 0 })
      expect(c.handoff.lead('lead-1')?.responsavelId).toBe('sdr') // ownership intocado
      expect(c.mensagensGrupo).toHaveLength(0)
      expect(c.notif.linhas).toHaveLength(0)
      expect(c.fila.pendentes()).toBe(0)
      expect(c.store.interacoes.filter((i) => i.tipo === 'resposta')).toHaveLength(1)
      expect((await followUp(c.store, c.email)).enviados).toBe(0)
      if (cls === 'indeterminado') expect(c.store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('revisar manualmente'))).toBe(true)
    })
  }

  it('5. evento duplicado (mesma mensagem liberada e relida) segue idempotente: 1 handoff, 1 alerta, cursor 1', async () => {
    const c = cenario('positivo')
    c.email.injetar(c.msg({ mensagemId: '<dup@acme>' }))
    await detectarResposta(c.store, c.email, c.fila, c.opts)
    await c.store.liberarMensagem('<dup@acme>')
    const email2 = new SimulatedProvider()
    email2.injetar(c.msg({ mensagemId: '<dup@acme>' }))
    await detectarResposta(c.store, email2, new Queue(), c.opts)

    expect(c.handoff.handoffs(ORG)).toHaveLength(1)
    expect(c.handoff.cursor(ORG).versao).toBe(1)
    expect(c.mensagensGrupo).toHaveLength(1)
    expect(c.notif.linhas).toHaveLength(1)
  })
})
