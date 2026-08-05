import { describe, it, expect } from 'vitest'
import {
  calcularScore,
  horasEntre,
  SCORE_BASE,
  SCORE_BONUS_RESPONDEU,
} from '../scoring'

describe('calcularScore', () => {
  it('quem não respondeu fica na base', () => {
    expect(calcularScore({ respondeu: false })).toBe(SCORE_BASE)
    expect(calcularScore({ respondeu: false, horasAteResposta: 3 })).toBe(SCORE_BASE)
  })

  it('respondeu sem tempo conhecido soma só o bônus de resposta', () => {
    expect(calcularScore({ respondeu: true })).toBe(SCORE_BASE + SCORE_BONUS_RESPONDEU)
    expect(calcularScore({ respondeu: true, horasAteResposta: null })).toBe(
      SCORE_BASE + SCORE_BONUS_RESPONDEU,
    )
  })

  it('quanto mais rápido responde, maior o score (monotônico decrescente no tempo)', () => {
    const quaseJa = calcularScore({ respondeu: true, horasAteResposta: 0 })
    const umDia = calcularScore({ respondeu: true, horasAteResposta: 24 })
    const tresDias = calcularScore({ respondeu: true, horasAteResposta: 72 })
    expect(quaseJa).toBeGreaterThan(umDia)
    expect(umDia).toBeGreaterThan(tresDias)
    // resposta imediata chega perto do teto
    expect(quaseJa).toBe(100)
  })

  it('nunca passa de 100 nem fica abaixo de 0', () => {
    expect(calcularScore({ respondeu: true, horasAteResposta: 0 })).toBeLessThanOrEqual(100)
    expect(calcularScore({ respondeu: true, horasAteResposta: 100000 })).toBeGreaterThanOrEqual(0)
  })
})

describe('horasEntre', () => {
  it('devolve null quando falta dado', () => {
    expect(horasEntre(null, new Date())).toBeNull()
    expect(horasEntre('2026-08-01T10:00:00Z', null)).toBeNull()
  })

  it('calcula a diferença em horas', () => {
    const h = horasEntre('2026-08-01T10:00:00Z', '2026-08-01T13:00:00Z')
    expect(h).toBeCloseTo(3, 5)
  })

  it('resposta antes do envio (dado inconsistente) vira null', () => {
    expect(horasEntre('2026-08-01T13:00:00Z', '2026-08-01T10:00:00Z')).toBeNull()
  })
})
