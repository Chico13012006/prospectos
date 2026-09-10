import { describe, it, expect } from 'vitest'
import {
  normalizarTelefone,
  variantesTelefoneBr,
  telefonesEquivalentes,
} from '../telefone'

describe('normalizarTelefone', () => {
  it('remove tudo que não for dígito', () => {
    expect(normalizarTelefone('+55 (11) 99153-2368')).toBe('5511991532368')
    expect(normalizarTelefone('11 9 9153 2368')).toBe('11991532368')
    expect(normalizarTelefone('(11)99153-2368')).toBe('11991532368')
  })
  it('null/undefined/vazio viram string vazia', () => {
    expect(normalizarTelefone(null)).toBe('')
    expect(normalizarTelefone(undefined)).toBe('')
    expect(normalizarTelefone('')).toBe('')
    expect(normalizarTelefone('sem número')).toBe('')
  })
})

describe('variantesTelefoneBr', () => {
  it('celular local (11 díg.) -> com e sem DDI', () => {
    expect(variantesTelefoneBr('11991532368').sort()).toEqual(
      ['11991532368', '5511991532368'].sort(),
    )
  })
  it('fixo local (10 díg.) -> com e sem DDI', () => {
    expect(variantesTelefoneBr('1132390777').sort()).toEqual(
      ['1132390777', '551132390777'].sort(),
    )
  })
  it('celular com DDI (13 díg.) -> com e sem DDI', () => {
    expect(variantesTelefoneBr('5511991532368').sort()).toEqual(
      ['11991532368', '5511991532368'].sort(),
    )
  })
  it('fixo com DDI (12 díg.) -> com e sem DDI', () => {
    expect(variantesTelefoneBr('551132390777').sort()).toEqual(
      ['1132390777', '551132390777'].sort(),
    )
  })
  it('curto demais ou lixo concatenado -> nenhuma variante', () => {
    expect(variantesTelefoneBr('998877')).toEqual([])
    expect(variantesTelefoneBr('2196902361521979393105')).toEqual([])
    expect(variantesTelefoneBr('')).toEqual([])
    // 9 díg. (sem DDD) não é reconhecível -> sem variante
    expect(variantesTelefoneBr('991532368')).toEqual([])
  })
})

describe('telefonesEquivalentes', () => {
  it('CASO REAL Laudos: 5511991532368 (WhatsApp) casa com 11991532368 (base)', () => {
    expect(telefonesEquivalentes('5511991532368', '11991532368')).toBe(true)
  })
  it('é simétrico', () => {
    expect(telefonesEquivalentes('11991532368', '5511991532368')).toBe(true)
  })
  it('ignora máscara dos dois lados', () => {
    expect(telefonesEquivalentes('+55 (11) 99153-2368', '11 99153-2368')).toBe(true)
    expect(telefonesEquivalentes('55 11 99153-2368', '(011) 99153-2368')).toBe(false) // (011) -> 011991532368 = 12 díg. não-55, não reconhecível
  })
  it('números diferentes NÃO casam', () => {
    expect(telefonesEquivalentes('5511991532368', '11991532369')).toBe(false)
    expect(telefonesEquivalentes('5511991532368', '5521991532368')).toBe(false)
  })
  it('não casa por sufixo/fragmento comum (sem match parcial)', () => {
    // um lado é lixo concatenado que "contém" o número -> não reconhecível
    expect(telefonesEquivalentes('5511991532368', '551199153236800000')).toBe(false)
    // assinante sem DDD não casa com número completo
    expect(telefonesEquivalentes('991532368', '11991532368')).toBe(false)
  })
  it('lados vazios/nulos não casam', () => {
    expect(telefonesEquivalentes(null, '11991532368')).toBe(false)
    expect(telefonesEquivalentes('11991532368', undefined)).toBe(false)
    expect(telefonesEquivalentes('', '')).toBe(false)
  })
})
