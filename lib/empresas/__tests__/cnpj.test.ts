import { describe, it, expect } from 'vitest'
import { normalizarCnpj, formatarCnpj } from '../cnpj'

describe('normalizarCnpj', () => {
  it('extrai só os 14 dígitos de um CNPJ formatado', () => {
    expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181')
    expect(normalizarCnpj(' 11222333000181 ')).toBe('11222333000181')
  })

  it('rejeita comprimento diferente de 14 (parcial/sujo → null, não casa por engano)', () => {
    expect(normalizarCnpj('11222333')).toBeNull()
    expect(normalizarCnpj('1122233300018199')).toBeNull()
    expect(normalizarCnpj('')).toBeNull()
    expect(normalizarCnpj('abc')).toBeNull()
  })

  it('aceita number e tipos inesperados', () => {
    expect(normalizarCnpj(11222333000181)).toBe('11222333000181')
    expect(normalizarCnpj(null)).toBeNull()
    expect(normalizarCnpj(undefined)).toBeNull()
    expect(normalizarCnpj({})).toBeNull()
  })

  it('formata a partir do normalizado; entrada inválida volta como veio', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81')
    expect(formatarCnpj('parcial')).toBe('parcial')
  })
})
