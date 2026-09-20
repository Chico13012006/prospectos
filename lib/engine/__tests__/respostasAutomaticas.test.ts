import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agendarMonitorRespostas,
  executarCicloMonitorRespostas,
  haEnvioRecenteParaMonitorar,
  INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS,
  montarProximoMonitorRespostas,
  reativarMonitoresRespostas,
  TOPICO_MONITOR_RESPOSTAS,
  validarMensagemMonitorRespostas,
} from '../respostasAutomaticas'

function dbComResultado(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const metodo of ['select', 'eq', 'gte', 'order', 'limit']) {
    chain[metodo] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient
  return { db, chain }
}

describe('monitor automático de respostas', () => {
  it('alinha organizações concorrentes no mesmo ciclo de dois minutos', () => {
    const primeira = montarProximoMonitorRespostas('org-1', new Date('2026-08-24T14:00:01.000Z'))
    const segunda = montarProximoMonitorRespostas('org-1', new Date('2026-08-24T14:01:59.000Z'))

    expect(INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS).toBe(120)
    expect(primeira.agendadoPara).toBe('2026-08-24T14:02:00.000Z')
    expect(primeira.delaySeconds).toBe(119)
    expect(segunda.delaySeconds).toBe(1)
    expect(primeira.idempotencyKey).toBe(segunda.idempotencyKey)
  })

  it('publica mensagem deduplicável na fila oficial', async () => {
    const enfileirar = vi.fn().mockResolvedValue({ messageId: 'msg-1' })

    const agenda = await agendarMonitorRespostas('org-1', {
      agora: new Date('2026-08-24T14:00:30.000Z'),
      enfileirar,
    })

    expect(enfileirar).toHaveBeenCalledWith(
      TOPICO_MONITOR_RESPOSTAS,
      agenda.mensagem,
      expect.objectContaining({
        delaySeconds: 90,
        idempotencyKey: agenda.idempotencyKey,
      }),
    )
  })

  it('rejeita payload sem organização ou ciclo válido', () => {
    expect(() => validarMensagemMonitorRespostas({ organizacaoId: '', ciclo: 1 })).toThrow('incompleta')
    expect(() => validarMensagemMonitorRespostas({ organizacaoId: 'org-1', ciclo: -1 })).toThrow('incompleta')
  })

  it('mantém o monitor apenas quando a organização possui envio recente', async () => {
    const comEnvio = dbComResultado({ id: 'interacao-1' })
    const semEnvio = dbComResultado(null)

    await expect(haEnvioRecenteParaMonitorar(
      comEnvio.db,
      'org-1',
      new Date('2026-08-24T14:00:00.000Z'),
    )).resolves.toBe(true)
    await expect(haEnvioRecenteParaMonitorar(
      semEnvio.db,
      'org-2',
      new Date('2026-08-24T14:00:00.000Z'),
    )).resolves.toBe(false)

    expect(comEnvio.chain.eq).toHaveBeenCalledWith('organizacao_id', 'org-1')
    expect(comEnvio.chain.eq).toHaveBeenCalledWith('origem_acao', 'ia')
    expect(comEnvio.chain.eq).toHaveBeenCalledWith('canal', 'email')
  })

  it('execução normal agenda a próxima verificação mesmo sem mensagem nova', async () => {
    const processar = vi.fn().mockResolvedValue({ respostas: 0, ignoradas: 0 })
    const agendar = vi.fn().mockResolvedValue({ messageId: 'proxima' })

    await expect(executarCicloMonitorRespostas('org-1', { processar, agendar }))
      .resolves.toEqual({ respostas: 0, ignoradas: 0 })

    expect(processar).toHaveBeenCalledWith('org-1')
    expect(agendar).toHaveBeenCalledWith('org-1')
  })

  it('erro recuperável no processamento é propagado para retry sem matar a cadeia', async () => {
    const erro = new Error('Gmail temporariamente indisponível')
    const processar = vi.fn().mockRejectedValue(erro)
    const agendar = vi.fn().mockResolvedValue({ messageId: 'proxima' })

    await expect(executarCicloMonitorRespostas('org-1', { processar, agendar }))
      .rejects.toBe(erro)

    expect(agendar).toHaveBeenCalledWith('org-1')
  })

  it('watchdog recria uma cadeia ausente sem duplicar organizações inativas', async () => {
    const temEnvioRecente = vi.fn(async (org: string) => org !== 'org-inativa')
    const agendar = vi.fn().mockResolvedValue({ messageId: 'watchdog' })

    const resultado = await reativarMonitoresRespostas(
      ['org-ativa', 'org-inativa'],
      { temEnvioRecente, agendar },
    )

    expect(resultado).toEqual({ avaliadas: 2, reagendadas: 1, inativas: 1, erros: [] })
    expect(agendar).toHaveBeenCalledTimes(1)
    expect(agendar).toHaveBeenCalledWith('org-ativa')
  })

  it('watchdog isola falha de uma organização e continua recuperando as demais', async () => {
    const temEnvioRecente = vi.fn().mockResolvedValue(true)
    const agendar = vi.fn(async (org: string) => {
      if (org === 'org-com-erro') throw new Error('fila indisponível')
      return { messageId: org }
    })

    const resultado = await reativarMonitoresRespostas(
      ['org-com-erro', 'org-saudavel'],
      { temEnvioRecente, agendar },
    )

    expect(resultado.reagendadas).toBe(1)
    expect(resultado.erros).toEqual([{ organizacaoId: 'org-com-erro', erro: 'fila indisponível' }])
    expect(agendar).toHaveBeenCalledWith('org-saudavel')
  })
})
