import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agendarMonitorRespostas,
  haEnvioRecenteParaMonitorar,
  INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS,
  montarProximoMonitorRespostas,
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
})
