import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { processarExecucao } from '../executor'
import { registrarBlocosPadrao } from '../blocos'
import {
  reconciliarRetomadasProspeccao,
  retomarProspeccao, type MensagemRetomadaProspeccao,
} from '../retomadaProspeccao'
import type { AmbienteWorkflow } from '../ambiente'

const inicio = new Date('2026-09-21T12:00:00.000Z')
const registro = registrarBlocosPadrao()

function cenario(org = 'org-a', horas = [1, 2]) {
  const store = new MemoryWorkflowStore(org)
  const emails: string[] = []
  const jobs: Array<{ mensagem: MensagemRetomadaProspeccao; delay: number }> = []
  const estado = { campanha: 'ativa', respondeu: false, optout: false }
  const ambiente = {
    organizacaoId: org, simular: false,
    async buscarControleExecucaoCampanha() { return { status: estado.campanha, tipo: 'prospeccao', diasSemana: null, disparoUnico: true } },
    async enviarEmailTemplate(_lead: string, template: string) {
      if (estado.optout || estado.respondeu) return { enviado: false, assunto: template }
      emails.push(template)
      return { enviado: true, assunto: template }
    },
    async leadRespondeu() { return estado.respondeu },
    async sincronizarConclusaoCampanha() {},
  } as unknown as AmbienteWorkflow
  const enfileirar = vi.fn(async (_topico: string, mensagem: MensagemRetomadaProspeccao, opcoes: { delaySeconds: number }) => {
    jobs.push({ mensagem, delay: opcoes.delaySeconds })
  }) as unknown as typeof import('@vercel/queue').send
  async function iniciar(enfileirarInicial = enfileirar) {
    const def = {
      gatilho: { tipo: 'manual', config: {} }, condicoes: [],
      acoes: [
        { id: 'email-0', tipo: 'enviar_email', config: { template: 'inicial' } },
        { id: 'espera-1', tipo: 'esperar', config: { horas: horas[0] } },
        { id: 'email-1', tipo: 'enviar_email', config: { template: 'fup1' } },
        { id: 'espera-2', tipo: 'esperar', config: { horas: horas[1] } },
        { id: 'email-2', tipo: 'enviar_email', config: { template: 'fup2' } },
      ],
    }
    const wf = await store.criarWorkflow({ nome: 'Teste', rascunho_definicao: def })
    const versao = await store.criarVersao({ workflow_id: wf.id, numero: 1, definicao: def })
    await store.atualizarWorkflow(wf.id, { status: 'publicado', versao_atual_id: versao.id })
    const ex = await store.criarExecucao({ workflow_id: wf.id, versao_id: versao.id, lead_id: 'lead', campanha_id: 'campanha' })
    await processarExecucao(store, registro, ambiente, ex.id, inicio.toISOString(), { enfileirarRetomada: enfileirarInicial })
    return (await store.buscarExecucao(ex.id))!
  }
  return { store, emails, jobs, estado, ambiente, enfileirar, iniciar }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(inicio) })
afterEach(() => { vi.useRealTimers(); delete process.env.PROSPECCAO_TESTE_ORGANIZACAO_ID; delete process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS })

describe('despertar durável de prospecção', () => {
  it('persiste a primeira espera e publica delayed job; antes da hora não avança', async () => {
    const c = cenario()
    const ex = await c.iniciar()
    expect(ex).toMatchObject({ status: 'aguardando', passo_atual: 2, agendamento_geracao: 1 })
    expect(c.jobs).toHaveLength(1)
    expect(c.jobs[0].delay).toBe(3600)
    expect(c.emails).toEqual(['inicial'])
    expect(await retomarProspeccao(c.store, registro, c.ambiente, c.jobs[0].mensagem,
      { enfileirar: c.enfileirar })).toBe('rearmada')
    expect(c.emails).toEqual(['inicial'])
  })

  it('vence FUP1 e FUP2 pelo executor normal; job duplicado e geração antiga são no-op', async () => {
    const c = cenario()
    await c.iniciar()
    const primeiro = c.jobs[0].mensagem
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    const resultados = await Promise.all([
      retomarProspeccao(c.store, registro, c.ambiente, primeiro, { enfileirar: c.enfileirar }),
      retomarProspeccao(c.store, registro, c.ambiente, primeiro, { enfileirar: c.enfileirar }),
    ])
    expect(resultados.sort()).toEqual(['ignorada', 'processada'])
    expect(c.emails).toEqual(['inicial', 'fup1'])
    expect((await c.store.buscarExecucao(primeiro.execucaoId))?.agendamento_geracao).toBe(2)
    expect(await retomarProspeccao(c.store, registro, c.ambiente, primeiro, { enfileirar: c.enfileirar })).toBe('ignorada')
    vi.setSystemTime(new Date(inicio.getTime() + 3 * 3_600_000))
    await retomarProspeccao(c.store, registro, c.ambiente, c.jobs.at(-1)!.mensagem, { enfileirar: c.enfileirar })
    expect(c.emails).toEqual(['inicial', 'fup1', 'fup2'])
    expect((await c.store.buscarExecucao(primeiro.execucaoId))?.status).toBe('concluido')
  })

  it('resposta durante espera cancela e job posterior não envia', async () => {
    const c = cenario()
    const ex = await c.iniciar()
    c.estado.respondeu = true
    await c.store.atualizarExecucao(ex.id, { status: 'cancelado' })
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    expect(await retomarProspeccao(c.store, registro, c.ambiente, c.jobs[0].mensagem)).toBe('ignorada')
    expect(c.emails).toEqual(['inicial'])
  })

  it('campanha pausada e opt-out não enviam FUP', async () => {
    const pausada = cenario()
    await pausada.iniciar()
    pausada.estado.campanha = 'pausada'
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    await retomarProspeccao(pausada.store, registro, pausada.ambiente, pausada.jobs[0].mensagem)
    expect(pausada.emails).toEqual(['inicial'])

    vi.setSystemTime(inicio)
    const optout = cenario()
    await optout.iniciar()
    optout.estado.optout = true
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    await retomarProspeccao(optout.store, registro, optout.ambiente, optout.jobs[0].mensagem, { enfileirar: optout.enfileirar })
    expect(optout.emails).toEqual(['inicial'])
  })

  it('watchdog concorrente não rouba claim nem duplica FUP', async () => {
    const c = cenario()
    await c.iniciar()
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    await Promise.all([
      retomarProspeccao(c.store, registro, c.ambiente, c.jobs[0].mensagem, { enfileirar: c.enfileirar }),
      reconciliarRetomadasProspeccao(c.store, { enfileirar: c.enfileirar }),
    ])
    expect(c.emails).toEqual(['inicial', 'fup1'])
  })

  it('espera acima de 7 dias usa checkpoint e não antecipa envio', async () => {
    const c = cenario('org-a', [24 * 15, 1])
    const ex = await c.iniciar()
    expect(c.jobs[0].delay).toBe(6 * 24 * 3600)
    vi.setSystemTime(new Date(inicio.getTime() + 6 * 24 * 3_600_000))
    expect(await retomarProspeccao(c.store, registro, c.ambiente, c.jobs[0].mensagem,
      { enfileirar: c.enfileirar })).toBe('rearmada')
    expect(c.emails).toEqual(['inicial'])
    expect((await c.store.buscarExecucao(ex.id))?.agendamento_geracao).toBe(2)
    expect(c.jobs[1].delay).toBe(6 * 24 * 3600)
  })

  it('falha de publicação preserva intenção e watchdog recupera', async () => {
    const c = cenario()
    const falhar = vi.fn(async () => { throw new Error('fila indisponível') }) as unknown as typeof import('@vercel/queue').send
    const ex = await c.iniciar(falhar)
    expect(ex).toMatchObject({ status: 'aguardando', agendamento_geracao: 1, agendamento_publicado_em: null })
    const resultado = await reconciliarRetomadasProspeccao(c.store, { enfileirar: c.enfileirar })
    expect(resultado.publicadas).toBe(1)
    expect(c.jobs).toHaveLength(1)
  })

  it('publicação que falha em uma execução não interrompe o reparo das outras', async () => {
    const c = cenario()
    const falhar = vi.fn(async () => { throw new Error('fila indisponível') }) as unknown as typeof import('@vercel/queue').send
    const a = await c.iniciar(falhar)
    const b = await c.iniciar(falhar)
    const [ruim, bom] = [a.id, b.id].sort() // o watchdog varre em ordem de id
    const seletivo = vi.fn(async (_topico: string, mensagem: MensagemRetomadaProspeccao, opcoes: { delaySeconds: number }) => {
      if (mensagem.execucaoId === ruim) throw new Error('fila recusou este job')
      c.jobs.push({ mensagem, delay: opcoes.delaySeconds })
    }) as unknown as typeof import('@vercel/queue').send
    const resultado = await reconciliarRetomadasProspeccao(c.store, { enfileirar: seletivo })
    expect(resultado).toMatchObject({ examinadas: 2, publicadas: 1, falhas: 1 })
    expect(c.jobs.map((j) => j.mensagem.execucaoId)).toEqual([bom])
    // A intenção da que falhou continua sem publicação — o próximo tick tenta de novo.
    expect((await c.store.buscarExecucao(ruim))?.agendamento_publicado_em).toBeFalsy()
  })

  it('claim expirado é reparado sem permitir dois claims simultâneos', async () => {
    const c = cenario()
    const ex = await c.iniciar()
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000))
    const [a, b] = await Promise.all([
      c.store.reivindicarRetomadaProspeccao(ex.id, 1, 2, 'token-a'),
      c.store.reivindicarRetomadaProspeccao(ex.id, 1, 2, 'token-b'),
    ])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    vi.setSystemTime(new Date(inicio.getTime() + 3_600_000 + 601_000))
    const resultado = await reconciliarRetomadasProspeccao(c.store, { enfileirar: c.enfileirar })
    expect(resultado.publicadas).toBe(1)
    expect((await c.store.buscarExecucao(ex.id))?.agendamento_geracao).toBe(2)
  })

  it('modo teste comprime só a organização configurada e a fila é a mesma', async () => {
    process.env.PROSPECCAO_TESTE_ORGANIZACAO_ID = 'org-a'
    process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = '2'
    const a = cenario('org-a', [24, 24])
    const b = cenario('org-b', [24, 24])
    const [exA, exB] = await Promise.all([a.iniciar(), b.iniciar()])
    expect(new Date(exA.proxima_verificacao_em!).getTime() - inicio.getTime()).toBe(120_000)
    expect(new Date(exB.proxima_verificacao_em!).getTime() - inicio.getTime()).toBe(86_400_000)
    expect(a.jobs[0].mensagem.organizacaoId).toBe('org-a')
    expect(b.jobs[0].mensagem.organizacaoId).toBe('org-b')
    await expect(retomarProspeccao(b.store, registro, b.ambiente, a.jobs[0].mensagem)).rejects.toThrow('Organização incompatível')
  })
})
