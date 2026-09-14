// Scheduler comercial do check-in (Fase 3): decisões puras (quando acordar,
// grade de slots, chave idempotente) e o tick completo sobre o serviço real em
// memória — sem fila real, sem e-mail, relógio injetado.
import { describe, it, expect } from 'vitest'
import {
  INTERVALO_MAX_SEGUNDOS, INTERVALO_MIN_SEGUNDOS, INTERVALO_RETENTATIVA_SEGUNDOS, TOPICO_ACOMPANHAMENTO,
  agendarAcompanhamento, calcularProximoTick, executarTickAcompanhamento, montarAgendamento,
  validarMensagemAcompanhamento, MensagemAcompanhamentoInvalida, type EnfileirarAcompanhamento,
} from '../acompanhamentoScheduler'
import { processarAcompanhamentoHandoff, type DepsAcompanhamento } from '../acompanhamentoService'
import { atribuirResponsavelHandoff } from '../handoffService'
import { processarRespostaPositivaProspeccao } from '../gatilhoProspeccao'
import { MemoryHandoffRepository } from './memoryRepository'
import { MemoryNotificacaoRepository } from '../../notificacoes/__tests__/memoryRepository'
import type { EnviadorGrupo } from '../../notificacoes/types'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const GRUPO = '120363019502650977-group'
const T0 = '2026-09-13T12:00:00.000Z'
const MIN = 60_000
const em = (deltaMs: number) => new Date(new Date(T0).getTime() + deltaMs).toISOString()

// Fila falsa: só registra o que seria enfileirado.
function filaFake() {
  const enviados: { topico: string; mensagem: { organizacaoId: string; slot: number }; opcoes: { delaySeconds: number; retentionSeconds: number; idempotencyKey: string } }[] = []
  const enfileirar: EnfileirarAcompanhamento = async (topico, mensagem, opcoes) => { enviados.push({ topico, mensagem, opcoes }) }
  return { enviados, enfileirar }
}

describe('scheduler — decisões puras', () => {
  it('validarMensagemAcompanhamento aceita {organizacaoId, slot} e rejeita o resto', () => {
    expect(validarMensagemAcompanhamento({ organizacaoId: ORG_A, slot: 1000 })).toEqual({ organizacaoId: ORG_A, slot: 1000 })
    for (const ruim of [null, 'x', [], {}, { organizacaoId: '', slot: 1 }, { organizacaoId: ORG_A }, { organizacaoId: ORG_A, slot: 1.5 }, { organizacaoId: ORG_A, slot: -1 }]) {
      expect(() => validarMensagemAcompanhamento(ruim)).toThrow(MensagemAcompanhamentoInvalida)
    }
  })

  it('calcularProximoTick: pendentes → retentativa; próximo vencimento → clamp [2 min, 30 min]; nada → null', () => {
    const agora = new Date(T0)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: null, haPendentes: true })).toBe(INTERVALO_RETENTATIVA_SEGUNDOS)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: em(3 * MIN), haPendentes: false })).toBe(180)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: em(10_000), haPendentes: false })).toBe(INTERVALO_MIN_SEGUNDOS)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: em(-5 * MIN), haPendentes: false })).toBe(INTERVALO_MIN_SEGUNDOS)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: em(6 * 24 * 60 * MIN), haPendentes: false })).toBe(INTERVALO_MAX_SEGUNDOS)
    expect(calcularProximoTick(agora, { proximoVencimentoEm: null, haPendentes: false })).toBeNull()
  })

  it('montarAgendamento alinha à grade de 2 min (nunca antes) e a chave é por org+slot', () => {
    const agora = new Date('2026-09-13T12:00:30.000Z')
    const a = montarAgendamento(ORG_A, 180, agora)
    expect(a.mensagem.slot % INTERVALO_MIN_SEGUNDOS).toBe(0)
    expect(a.agendadoPara).toBe('2026-09-13T12:04:00.000Z') // 12:03:30 → próximo slot da grade
    expect(a.delaySeconds).toBe(210)
    expect(a.retentionSeconds).toBeGreaterThan(a.delaySeconds)
    expect(a.idempotencyKey).toBe(`acompanhamento:${ORG_A}:${a.mensagem.slot}`)
    // Dois agendamentos para o mesmo momento (handoff novo + cron) colapsam na mesma chave.
    expect(montarAgendamento(ORG_A, 175, agora).idempotencyKey).toBe(a.idempotencyKey)
    // Orgs diferentes nunca compartilham chave.
    expect(montarAgendamento(ORG_B, 180, agora).idempotencyKey).not.toBe(a.idempotencyKey)
    expect(() => montarAgendamento('', 10, agora)).toThrow()
  })

  it('agendarAcompanhamento publica no tópico comercial com delay/retention/chave', async () => {
    const fila = filaFake()
    const a = await agendarAcompanhamento(ORG_A, { delaySeconds: 120, agora: new Date(T0), enfileirar: fila.enfileirar })
    expect(fila.enviados).toHaveLength(1)
    expect(fila.enviados[0].topico).toBe(TOPICO_ACOMPANHAMENTO)
    expect(fila.enviados[0].mensagem).toEqual(a.mensagem)
    expect(fila.enviados[0].opcoes).toEqual({ delaySeconds: a.delaySeconds, retentionSeconds: a.retentionSeconds, idempotencyKey: a.idempotencyKey })
  })
})

// --- tick completo sobre o serviço real (memória) --------------------------
function cenario(o: { janela?: number; grupo?: string | null; envio?: 'ok' | 'offline' } = {}) {
  const handoff = new MemoryHandoffRepository()
    .addUsuario({ id: 'bruno', organizacaoId: ORG_A, nome: 'Bruno', email: 'bruno@a' })
    .addUsuario({ id: 'silmara', organizacaoId: ORG_A, nome: 'Silmara', email: 'silmara@a' })
    .addUsuario({ id: 'ana-b', organizacaoId: ORG_B, nome: 'Ana', email: 'ana@b' })
    .participar(ORG_A, 'bruno').participar(ORG_A, 'silmara').participar(ORG_B, 'ana-b')
    .addLead({ id: 'la1', organizacaoId: ORG_A, empresa: 'Metalúrgica ABC', contatoNome: 'João Silva' })
    .addLead({ id: 'la2', organizacaoId: ORG_A, empresa: 'Padaria XYZ', contatoNome: 'Maria' })
    .addLead({ id: 'lb1', organizacaoId: ORG_B, empresa: 'Org B Ltda', contatoNome: 'Caio' })
  const notif = new MemoryNotificacaoRepository()
  const chamadas: { grupoId: string; mensagem: string }[] = []
  let modo = o.envio ?? 'ok'
  const enviar: EnviadorGrupo = async (grupoId, mensagem) => {
    chamadas.push({ grupoId, mensagem })
    return modo === 'ok' ? { ok: true, providerMessageId: `z${chamadas.length}` } : { ok: false, codigo: 'zapi_desconectada', mensagem: 'offline' }
  }
  const grupo = o.grupo === undefined ? GRUPO : o.grupo
  let agora = T0
  const deps: DepsAcompanhamento = {
    handoff,
    notificacoes: { repo: notif, enviar, lerGrupoId: async () => grupo },
    lerJanelaMinutos: async () => o.janela ?? 10080,
    agora: () => new Date(agora),
  }
  const fila = filaFake()
  const processar = (org: string) => processarAcompanhamentoHandoff(deps, org)
  const tick = (org = ORG_A) => executarTickAcompanhamento(processar, org, { agora: new Date(agora), enfileirar: fila.enfileirar })
  async function atribuir(leadId: string, quando: string, org = ORG_A) {
    handoff.agoraFixo = quando
    const r = await atribuirResponsavelHandoff(handoff, { organizacaoId: org, leadId, eventoId: `ev-${leadId}`, origem: 'prospeccao' })
    handoff.agoraFixo = null
    if (r.tipo !== 'atribuido') throw new Error(`esperava atribuido, veio ${r.tipo}`)
    return r
  }
  return { deps, handoff, notif, chamadas, fila, tick, atribuir, avancarPara: (iso: string) => { agora = iso }, setEnvio: (m: 'ok' | 'offline') => { modo = m } }
}

describe('scheduler — tick completo (sem e-mail, sem monitor)', () => {
  it('1/2. org SEM nenhum envio de e-mail (nem interações) é processada: só depende do handoff aberto', async () => {
    // Este cenário não tem motor de e-mail, caixa, interações nem monitor:
    // o único insumo é comercial_handoffs.atribuido_em + a janela da org.
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    const { resumo, proximo } = await c.tick()
    expect(resumo.enviados).toBe(1)
    expect(c.chamadas[0].mensagem).toContain('@Bruno, como ficou o lead Metalúrgica ABC?')
    // Nada mais a esperar → a corrente termina (nenhum reagendamento).
    expect(proximo).toBeNull()
    expect(c.fila.enviados).toHaveLength(0)
  })

  it('3/6. janela de 5 min: tick antes do vencimento não envia e dorme exatamente até vencer', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(2 * MIN)) // 1º tick (semeado pelo handoff, 2 min depois)
    const t1 = await c.tick()
    expect(t1.resumo).toMatchObject({ abertos: 1, vencidos: 0, enviados: 0, proximoVencimentoEm: em(5 * MIN), haPendentes: false })
    expect(c.chamadas).toHaveLength(0)
    expect(t1.proximo?.agendadoPara).toBe(em(6 * MIN)) // faltam 3 min → 180s, alinhado à grade de 2 min
    c.avancarPara(t1.proximo!.agendadoPara)
    const t2 = await c.tick()
    expect(t2.resumo.enviados).toBe(1)
    expect(t2.proximo).toBeNull()
    expect(c.chamadas).toHaveLength(1)
  })

  it('produção: 7 dias → dorme no máximo 30 min por tick, sem chamar a Z-API', async () => {
    const c = cenario()
    await c.atribuir('la1', T0)
    c.avancarPara(em(2 * MIN))
    const t = await c.tick()
    expect(t.resumo.vencidos).toBe(0)
    expect(t.proximo?.delaySeconds).toBe(INTERVALO_MAX_SEGUNDOS)
    expect(c.chamadas).toHaveLength(0)
  })

  it('4. dois ticks concorrentes (duas correntes vivas) → uma única chamada à Z-API', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    let chegaram = 0; let liberar!: () => void
    const barreira = new Promise<void>((res) => { liberar = res })
    c.notif.antesDeReivindicar = async () => { if (++chegaram === 2) liberar(); await barreira }
    const [a, b] = await Promise.all([c.tick(), c.tick()])
    expect(a.resumo.enviados + b.resumo.enviados).toBe(1)
    expect(c.chamadas).toHaveLength(1)
    expect(c.notif.linhas).toHaveLength(1)
    // O perdedor viu 'concorrente' → pede retentativa; o vencedor encerra.
    const proximos = [a.proximo, b.proximo].filter(Boolean)
    expect(proximos).toHaveLength(1)
    expect(proximos[0]?.delaySeconds).toBe(INTERVALO_RETENTATIVA_SEGUNDOS)
    // A retentativa só confirma 'ja_enviado' e a corrente morre.
    c.avancarPara(proximos[0]!.agendadoPara)
    const t3 = await c.tick()
    expect(t3.resumo.jaEnviados).toBe(1)
    expect(t3.proximo).toBeNull()
    expect(c.chamadas).toHaveLength(1)
  })

  it('5. tick da org A não vê nem agenda nada da org B', async () => {
    const c = cenario({ janela: 5 })
    await c.atribuir('lb1', T0, ORG_B)
    c.avancarPara(em(6 * MIN))
    const a = await c.tick(ORG_A)
    expect(a.resumo).toMatchObject({ abertos: 0, enviados: 0 })
    expect(a.proximo).toBeNull()
    expect(c.chamadas).toHaveLength(0)
    const b = await c.tick(ORG_B)
    expect(b.resumo.enviados).toBe(1)
    expect(c.chamadas[0].mensagem).toContain('@Ana')
    expect(c.fila.enviados.every((e) => e.mensagem.organizacaoId === ORG_B || e.mensagem.organizacaoId === ORG_A)).toBe(true)
  })

  it('Z-API offline: corrente volta em 10 min e entrega uma vez quando a Z-API volta', async () => {
    const c = cenario({ janela: 5, envio: 'offline' })
    await c.atribuir('la1', T0)
    c.avancarPara(em(6 * MIN))
    const t1 = await c.tick()
    expect(t1.resumo.haPendentes).toBe(true)
    expect(t1.proximo?.delaySeconds).toBe(INTERVALO_RETENTATIVA_SEGUNDOS)
    c.setEnvio('ok')
    c.avancarPara(t1.proximo!.agendadoPara)
    const t2 = await c.tick()
    expect(t2.resumo.enviados).toBe(1)
    expect(t2.proximo).toBeNull()
    expect(c.chamadas).toHaveLength(2)
    expect(c.notif.linhas).toHaveLength(1)
  })

  it('o handoff (gatilho da Fase 2) semeia a corrente da sua org — sem depender de e-mail', async () => {
    const c = cenario({ janela: 5 })
    const agendados: string[] = []
    const r = await processarRespostaPositivaProspeccao(
      { handoff: c.handoff, notificacoes: c.deps.notificacoes, agendarAcompanhamento: async (org) => { agendados.push(org) } },
      { organizacaoId: ORG_A, leadId: 'la2', eventoId: 'ev-x', empresa: 'Padaria XYZ', contatoNome: 'Maria', etapaCadencia: 'follow-up 1' },
    )
    expect(r.handoff.tipo).toBe('atribuido')
    expect(agendados).toEqual([ORG_A])
    // Reprocessar o mesmo evento (ja_processado) não semeia de novo.
    const r2 = await processarRespostaPositivaProspeccao(
      { handoff: c.handoff, notificacoes: c.deps.notificacoes, agendarAcompanhamento: async (org) => { agendados.push(org) } },
      { organizacaoId: ORG_A, leadId: 'la2', eventoId: 'ev-x', empresa: 'Padaria XYZ', contatoNome: 'Maria', etapaCadencia: 'follow-up 1' },
    )
    expect(r2.handoff.tipo).toBe('ja_processado')
    expect(agendados).toEqual([ORG_A])
  })

  it('falha ao semear a corrente não desfaz o handoff nem o aviso', async () => {
    const c = cenario({ janela: 5 })
    const r = await processarRespostaPositivaProspeccao(
      { handoff: c.handoff, notificacoes: c.deps.notificacoes, agendarAcompanhamento: async () => { throw new Error('fila fora') } },
      { organizacaoId: ORG_A, leadId: 'la2', eventoId: 'ev-y', empresa: 'Padaria XYZ', contatoNome: 'Maria', etapaCadencia: 'follow-up 1' },
    )
    expect(r.handoff.tipo).toBe('atribuido')
    expect(r.notificacao?.tipo).toBe('enviada')
    expect(c.handoff.handoffs(ORG_A)).toHaveLength(1)
  })
})
