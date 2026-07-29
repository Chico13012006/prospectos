import { describe, it, expect } from 'vitest'
import { avaliarOperador, OPERADORES } from '../operadores'

describe('avaliarOperador', () => {
  it('igual/diferente — texto case-insensitive e numérico', () => {
    expect(avaliarOperador('igual', 'Follow_Up_1', 'follow_up_1')).toBe(true)
    expect(avaliarOperador('igual', 3, '3')).toBe(true) // numérico
    expect(avaliarOperador('diferente', 'ganho', 'perdido')).toBe(true)
    expect(avaliarOperador('diferente', 'ganho', 'ganho')).toBe(false)
  })

  it('maior_que/menor_que — numérico e data; texto livre não ordena', () => {
    expect(avaliarOperador('maior_que', 10, 5)).toBe(true)
    expect(avaliarOperador('menor_que', 5, 10)).toBe(true)
    expect(avaliarOperador('maior_que', '2026-02-01', '2026-01-01')).toBe(true) // datas
    expect(avaliarOperador('maior_que', 'abc', 'aaa')).toBe(false) // sem ordem numérica/data
  })

  it('contem — substring case-insensitive; vazio nunca contém', () => {
    expect(avaliarOperador('contem', 'Hotelaria Premium', 'hotel')).toBe(true)
    expect(avaliarOperador('contem', null, 'x')).toBe(false)
  })

  it('vazio/nao_vazio — null, undefined e string em branco contam como vazio', () => {
    expect(avaliarOperador('vazio', null)).toBe(true)
    expect(avaliarOperador('vazio', '   ')).toBe(true)
    expect(avaliarOperador('vazio', 'x')).toBe(false)
    expect(avaliarOperador('nao_vazio', 0)).toBe(true) // 0 não é vazio
  })

  it('ha_mais_de_dias — compara a data do campo contra agora - N dias', () => {
    const agora = '2026-07-29T00:00:00.000Z'
    const dezDiasAtras = '2026-07-19T00:00:00.000Z'
    const ontem = '2026-07-28T00:00:00.000Z'
    expect(avaliarOperador('ha_mais_de_dias', dezDiasAtras, 7, agora)).toBe(true)
    expect(avaliarOperador('ha_mais_de_dias', ontem, 7, agora)).toBe(false)
    expect(avaliarOperador('ha_mais_de_dias', null, 7, agora)).toBe(false)
  })

  it('OPERADORES cobre os tipos e marca quais usam valor', () => {
    const semValor = OPERADORES.filter((o) => !o.usaValor).map((o) => o.valor)
    expect(semValor).toEqual(['vazio', 'nao_vazio'])
  })
})
