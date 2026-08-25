import { describe, it, expect } from 'vitest'
import {
  calcularVencimento,
  consolidarValidades,
  diasAteVencimento,
  formatarDataIsoSemFuso,
  naJanelaRenovacao,
  resumirValidades,
} from '../vencimento'

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

describe('validade operacional', () => {
  it('formata DATE sem recuar um dia no fuso brasileiro', () => {
    expect(formatarDataIsoSemFuso('2026-08-30')).toBe('30/08/2026')
    expect(formatarDataIsoSemFuso('2026-08-30T00:00:00.000Z')).toBe('30/08/2026')
    expect(formatarDataIsoSemFuso('2026-02-30')).toBe('')
  })

  it('prioriza os serviços e usa o lead apenas como fallback sem duplicar empresa', () => {
    const validades = consolidarValidades(
      [
        { id: 's1', empresa_id: 'e1', vencimento_em: '2026-06-20' },
        { id: 's2', empresa_id: 'e1', vencimento_em: '2026-08-01' },
        { id: 's-sem-data', empresa_id: 'e2', vencimento_em: null },
      ],
      [
        { id: 'l1', empresa_id: 'e1', data_validade: '2026-06-10' },
        { id: 'l2', empresa_id: 'e2', data_validade: '2026-06-11' },
        { id: 'l3', empresa_id: 'e3', data_validade: '2026-06-12' },
        { id: 'l4', empresa_id: 'e3', data_validade: '2026-06-13' },
        { id: 'l5', empresa_id: null, data_validade: '2026-06-14' },
      ],
    )

    expect(validades).toEqual([
      { id: 's1', fonte: 'servico', empresaId: 'e1', vencimentoEm: '2026-06-20' },
      { id: 's2', fonte: 'servico', empresaId: 'e1', vencimentoEm: '2026-08-01' },
      { id: 'l3', fonte: 'lead_legado', empresaId: 'e3', vencimentoEm: '2026-06-12' },
      { id: 'l5', fonte: 'lead_legado', empresaId: null, vencimentoEm: '2026-06-14' },
    ])
  })

  it('separa vencidos, próximos 30 e próximos 60 dias com bordas inclusivas', () => {
    const hoje = new Date('2026-06-01T15:00:00.000Z')
    const validades = consolidarValidades(
      [
        { id: 'vencido', empresa_id: 'e1', vencimento_em: '2026-05-31' },
        { id: 'hoje', empresa_id: 'e2', vencimento_em: '2026-06-01' },
        { id: 'd30', empresa_id: 'e3', vencimento_em: '2026-07-01' },
        { id: 'd31', empresa_id: 'e4', vencimento_em: '2026-07-02' },
        { id: 'd60', empresa_id: 'e5', vencimento_em: '2026-07-31' },
        { id: 'd61', empresa_id: 'e6', vencimento_em: '2026-08-01' },
      ],
      [{ id: 'legado', empresa_id: 'e7', data_validade: '2026-06-15' }],
    )

    expect(resumirValidades(validades, hoje)).toEqual({
      vencidos: 1,
      proximos30: 3,
      entre31e60: 2,
      proximos60: 5,
      totalComData: 7,
      servicos: 6,
      legados: 1,
    })
  })
})
