import { describe, it, expect } from 'vitest'
import { calcularVencimento, diasAteVencimento, naJanelaRenovacao } from '../vencimento'

describe('calcularVencimento', () => {
  it('meses (validade típica de laudo: 6 meses)', () => {
    expect(calcularVencimento('2026-01-15', 6, 'meses')).toBe('2026-07-15')
  })
  it('dias e anos', () => {
    expect(calcularVencimento('2026-01-01', 180, 'dias')).toBe('2026-06-30')
    expect(calcularVencimento('2026-03-10', 1, 'anos')).toBe('2027-03-10')
  })
  it('sem dado suficiente => null', () => {
    expect(calcularVencimento(null, 6, 'meses')).toBeNull()
    expect(calcularVencimento('2026-01-15', null, 'meses')).toBeNull()
    expect(calcularVencimento('2026-01-15', 6, null)).toBeNull()
    expect(calcularVencimento('data-ruim', 6, 'meses')).toBeNull()
  })
})

describe('diasAteVencimento / naJanelaRenovacao', () => {
  const hoje = new Date('2026-06-01T12:00:00Z')
  it('conta dias (futuro positivo, passado negativo)', () => {
    expect(diasAteVencimento('2026-06-15', hoje)).toBe(14)
    expect(diasAteVencimento('2026-05-20', hoje)).toBe(-12)
    expect(diasAteVencimento(null, hoje)).toBeNull()
  })
  it('janela de renovação (45 dias de antecedência)', () => {
    expect(naJanelaRenovacao('2026-07-10', 45, hoje)).toBe(true) // faltam 39
    expect(naJanelaRenovacao('2026-09-01', 45, hoje)).toBe(false) // faltam 92
    expect(naJanelaRenovacao('2026-05-01', 45, hoje)).toBe(true) // já venceu
  })
})
