import { describe, expect, it } from 'vitest'
import { lerNumeroBr } from '../numeroBr'

describe('lerNumeroBr', () => {
  it('aceita decimal com vírgula e milhar com ponto', () => {
    expect(lerNumeroBr('1.500,50')).toBe(1500.5)
    expect(lerNumeroBr('1500,50')).toBe(1500.5)
    expect(lerNumeroBr('12.345.678,9')).toBe(12345678.9)
    expect(lerNumeroBr('0,99')).toBe(0.99)
  })
  it('sem vírgula: grupos de 3 após o ponto são milhar; senão ponto é decimal', () => {
    expect(lerNumeroBr('1.500')).toBe(1500)
    expect(lerNumeroBr('45')).toBe(45)
    expect(lerNumeroBr('4.5')).toBe(4.5)
    expect(lerNumeroBr('1500.5')).toBe(1500.5)
  })
  it('vazio é null; lixo é NaN', () => {
    expect(lerNumeroBr('  ')).toBeNull()
    expect(Number.isNaN(lerNumeroBr('abc') as number)).toBe(true)
    expect(Number.isNaN(lerNumeroBr('1,2,3') as number)).toBe(true)
    expect(Number.isNaN(lerNumeroBr('R$ 10') as number)).toBe(true)
  })
  it('mantém o sinal para o chamador recusar negativo', () => {
    expect(lerNumeroBr('-10')).toBe(-10)
  })
})
