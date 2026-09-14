// Fase 4 no MOTOR: follow-up de RETORNO (ciclo 'handoff_retorno:…') vs
// follow-up IMPORTADO (campanha 'followup' sem esse ciclo), com o pipeline
// completo em memória: detectarResposta → classificação → gatilho REAL →
// handoff (reativação) → grupo. Mais a guarda do motor legado.
import { describe, it, expect } from 'vitest'
import { MemoryStore } from '@/lib/engine/store/memoryStore'
import { SimulatedProvider } from '@/lib/engine/email/simulatedProvider'
import { Queue } from '@/lib/engine/queue'
import { detectarResposta, respostaVemDeProspeccao, descreverEtapaCadencia } from '@/lib/engine/flows/detectarResposta'
import { followUp } from '@/lib/engine/flows/followUp'
import type { ContextoCampanhaResposta, MensagemRecebida } from '@/lib/engine/types'
import { makeLead, SEMANA_PASSADA, ONTEM } from '@/lib/engine/__tests__/helpers'
import { processarRespostaPositivaProspeccao } from '../gatilhoProspeccao'
import { atribuirResponsavelHandoff } from '../handoffService'
import { MemoryHandoffRepository } from './memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import { cicloChaveRetorno, ehCicloDeRetornoHandoff, iniciarFollowupDeRetorno, type DepsRetornoFollowup } from '../../followup/retornoFollowup'
import type { ClassificacaoResposta } from '@/lib/comercial/respostas/classificarResposta'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG = 'org-a'
const GRUPO = '120363019502650977-group'

class StoreOrg extends MemoryStore {
  readonly organizacaoId = ORG
  cancelamentos: string[] = []
  contexto: ContextoCampanhaResposta | null = null
  async cancelarExecucoesWorkflow(leadId: string) { this.cancelamentos.push(leadId) }
  async buscarContextoCampanhaAtiva() { return this.contexto }
}

const contextoFollowup = (cicloChave: string | null): ContextoCampanhaResposta => ({
  id: 'camp-fup', execucaoId: 'ex-1', iniciadoEm: SEMANA_PASSADA, execucaoStatus: 'aguardando', cicloChave,
  nome: 'Follow-up', tipo: 'followup', responsavel: null, notificarResponsavel: true, emailAssunto: null, emailCorpo: null, emailHtml: null,
})

function cenario(classificacao: ClassificacaoResposta, contexto: ContextoCampanhaResposta | null) {
  // Lead que já passou por Bruno (handoff encerrado por retorno ao follow-up) e está em follow-up.
  const lead = makeLead({ id: 'lead-1', estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM, empresa: 'ACME', contato_nome: 'Ana', responsavel_id: 'bruno' })
  const store = new StoreOrg([lead])
  store.contexto = contexto
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG, nome: 'Silmara', email: 'silmara@a' })
    .participar(ORG, 'bruno').participar(ORG, 'silmara')
    .addLead({ id: 'lead-1', organizacaoId: ORG, responsavelId: 'bruno', empresa: 'ACME', contatoNome: 'Ana' })
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
    de: 'ana@acme.com.br', assunto: 'Re: follow-up', corpo: 'Oi, agora tenho interesse sim!', em: new Date(), mensagemId: '<m-retorno@acme>', ...over,
  })
  return { store, handoff, notif, mensagensGrupo, opts, email, fila, msg }
}

// Handoff anterior a Bruno, encerrado por "voltar para follow-up" (Fase 4).
async function handoffAnteriorEncerrado(handoff: MemoryHandoffRepository) {
  const primeiro = await atribuirResponsavelHandoff(handoff, { organizacaoId: ORG, leadId: 'lead-1', eventoId: 'ev-primeiro', origem: 'prospeccao' })
  if (primeiro.tipo !== 'atribuido') throw new Error('esperava atribuido')
  expect(primeiro.responsavel.id).toBe('bruno')
  await handoff.encerrar(ORG, primeiro.handoff.id, 'retorno_followup')
  return primeiro.handoff
}

describe('origem da resposta (Fase 4)', () => {
  it('ciclo handoff_retorno é reconhecido; followup importado não', () => {
    expect(ehCicloDeRetornoHandoff(cicloChaveRetorno('h1'))).toBe(true)
    expect(ehCicloDeRetornoHandoff('renovacao:2026')).toBe(false)
    expect(ehCicloDeRetornoHandoff(null)).toBe(false)
    expect(respostaVemDeProspeccao(true, contextoFollowup(cicloChaveRetorno('h1')), false)).toBe(true)
    // Campanha de follow-up importado tem precedência sobre o estágio de cadência: NÃO é prospecção.
    expect(respostaVemDeProspeccao(true, contextoFollowup(null), false)).toBe(false)
    expect(respostaVemDeProspeccao(false, null, false)).toBe(false)
    expect(descreverEtapaCadencia(2, contextoFollowup(cicloChaveRetorno('h1')), true)).toBe('follow-up de retorno')
  })
})

describe('resposta ao follow-up de RETORNO', () => {
  it('15/16/17. positivo → reativação para o MESMO comercial, cursor intacto, grupo "voltou a responder", cadência cancelada', async () => {
    const c = cenario('positivo', null)
    const anterior = await handoffAnteriorEncerrado(c.handoff)
    c.store.contexto = contextoFollowup(cicloChaveRetorno(anterior.id))
    const cursorAntes = c.handoff.cursor(ORG)
    c.email.injetar(c.msg())

    const r = await detectarResposta(c.store, c.email, c.fila, c.opts)

    expect(r.respostas).toBe(1)
    expect((await c.store.buscarLead('lead-1'))?.estagio).toBe('interessado')
    expect(c.store.cancelamentos).toEqual(['lead-1'])
    const abertos = c.handoff.handoffs(ORG).filter((h) => h.encerradoEm === null)
    expect(abertos).toHaveLength(1)
    expect(abertos[0]).toMatchObject({ motivo: 'reativacao', responsavelId: 'bruno', primeiraAtribuicao: false })
    expect(c.handoff.cursor(ORG)).toEqual(cursorAntes) // NÃO rodou round-robin
    expect(c.handoff.lead('lead-1')?.responsavelId).toBe('bruno')
    expect(c.mensagensGrupo).toHaveLength(1)
    expect(c.mensagensGrupo[0]).toContain('LEAD VOLTOU A RESPONDER — ProspectOS')
    expect(c.mensagensGrupo[0]).toContain('Empresa: ACME')
    expect(c.mensagensGrupo[0]).toContain('Contato: Ana')
    expect(c.mensagensGrupo[0]).toContain('Responsável: @Bruno')
    expect(c.mensagensGrupo[0]).toContain('retorna para o mesmo responsável')
    expect(c.fila.pendentes()).toBe(1) // closer avisado (Fluxo 3)
    expect(c.store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes('follow-up de retorno'))).toBe(true)
  })

  it('18. follow-up IMPORTADO (campanha followup sem ciclo de retorno) positivo → NÃO entra no handoff', async () => {
    const c = cenario('positivo', contextoFollowup(null))
    c.email.injetar(c.msg())
    const r = await detectarResposta(c.store, c.email, c.fila, c.opts)
    expect(r.respostas).toBe(1)
    expect(c.handoff.handoffs(ORG)).toHaveLength(0)
    expect(c.handoff.cursor(ORG).versao).toBe(0)
    expect(c.mensagensGrupo).toHaveLength(0)
    // Fora do handoff vale a semântica antiga: pausa e avisa o responsável da campanha/lead.
    expect((await c.store.buscarLead('lead-1'))?.estagio).toBe('interessado')
    expect(c.store.cancelamentos).toEqual(['lead-1'])
    expect(c.fila.pendentes()).toBe(1)
  })

  for (const [cls, estagio, trecho] of [
    ['negativo', 'perdido', 'marcado como perdido'],
    ['neutro', 'respondeu', 'pendente de tratamento humano'],
    ['indeterminado', 'respondeu', 'revisar manualmente'],
  ] as const) {
    it(`19/20/21. ${cls} no follow-up de retorno → '${estagio}', sem reativação, cursor intacto, cadência encerrada`, async () => {
      const c = cenario(cls, null)
      const anterior = await handoffAnteriorEncerrado(c.handoff)
      c.store.contexto = contextoFollowup(cicloChaveRetorno(anterior.id))
      c.email.injetar(c.msg({ corpo: cls === 'negativo' ? 'Não temos interesse.' : 'Do que se trata?' }))
      await detectarResposta(c.store, c.email, c.fila, c.opts)
      const lead = await c.store.buscarLead('lead-1')
      expect(lead?.estagio).toBe(estagio)
      expect(c.store.cancelamentos).toEqual(['lead-1'])
      expect(c.handoff.handoffs(ORG).filter((h) => h.encerradoEm === null)).toHaveLength(0)
      expect(c.handoff.cursor(ORG).versao).toBe(1) // só o handoff original (encerrado)
      expect(c.mensagensGrupo).toHaveLength(0)
      expect(c.fila.pendentes()).toBe(0)
      expect(c.store.interacoes.some((i) => i.tipo === 'nota' && i.descricao.includes(trecho))).toBe(true)
      expect((await followUp(c.store, c.email)).enviados).toBe(0)
    })
  }
})

describe('retorno ao follow-up — serviço e guarda do motor legado', () => {
  it('iniciarFollowupDeRetorno: inscreve com ciclo handoff_retorno, move o lead e agenda a 1ª mensagem; repetir é idempotente', async () => {
    const chamadas: string[] = []
    const deps: DepsRetornoFollowup = {
      resolverCampanhaRetorno: async () => ({ ok: true, campanhaId: 'camp', workflowId: 'wf' }),
      inscrever: async (_o, _w, _l, _c, ciclo) => { chamadas.push(`inscrever:${ciclo}`); return { execucaoId: 'ex', jaInscrito: chamadas.filter((x) => x.startsWith('inscrever')).length > 1 } },
      moverLeadParaFollowup: async (_o, l) => { chamadas.push(`mover:${l}`) },
      agendarPrimeiroEnvio: async (_o, _c, ex) => { chamadas.push(`agendar:${ex}`) },
    }
    const handoff = { id: 'h1', organizacaoId: ORG, leadId: 'lead-1', eventoId: 'e', origem: 'prospeccao', responsavelId: 'bruno', motivo: 'round_robin' as const, primeiraAtribuicao: true, status: 'em_contato_comercial' as const, atribuidoEm: 'x', encerradoEm: null, encerradoMotivo: null, criadoEm: 'x' }
    const r1 = await iniciarFollowupDeRetorno(deps, ORG, handoff)
    expect(r1).toEqual({ ok: true, campanhaId: 'camp', execucaoId: 'ex', jaInscrito: false })
    expect(chamadas).toEqual(['inscrever:handoff_retorno:h1', 'mover:lead-1', 'agendar:ex'])
    const r2 = await iniciarFollowupDeRetorno(deps, ORG, handoff)
    expect(r2).toMatchObject({ ok: true, jaInscrito: true })
    // Sem campanha: nada é chamado.
    const semCampanha = await iniciarFollowupDeRetorno({ ...deps, resolverCampanhaRetorno: async () => ({ ok: false, motivo: 'sem_campanha_retorno' }) }, ORG, handoff)
    expect(semCampanha).toMatchObject({ ok: false, motivo: 'sem_campanha_retorno' })
    expect(chamadas).toHaveLength(6)
  })

  it('motor legado NÃO envia nem esgota lead em follow-up com execução de workflow ativa (uma cadência só)', async () => {
    const lead = makeLead({ id: 'lead-1', estagio: 'follow_up', contato_email: 'ana@acme.com.br', ultimo_contato: SEMANA_PASSADA, proxima_acao_data: ONTEM, segmento: '' })
    const store = new MemoryStore([lead])
    const email = new SimulatedProvider()
    store.leadsEmWorkflowAtivo.add('lead-1')
    const r = await followUp(store, email)
    expect(r.enviados).toBe(0)
    expect(email.enviados).toHaveLength(0)
    expect((await store.buscarLead('lead-1'))?.estagio).toBe('follow_up')
    // Sem execução ativa, a esteira legada volta a funcionar normalmente.
    store.leadsEmWorkflowAtivo.clear()
    expect((await followUp(store, email)).enviados).toBe(1)
  })
})
