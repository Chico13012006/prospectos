// Segredo do link de descadastro separado do INTERNAL_SECRET: rotacionar o
// segredo interno não pode invalidar links de e-mails já enviados.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gerarTokenOptout, urlOptout, validarTokenOptout } from '../optout'

const LEAD = 'aaaaaaaa-6666-4666-8666-000000000001'
const OUTRO_LEAD = 'aaaaaaaa-6666-4666-8666-000000000002'
const CHAVES = ['INTERNAL_SECRET', 'OPTOUT_SECRET', 'OPTOUT_SECRET_LEGADO'] as const
const original = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]))

function env(valores: Partial<Record<(typeof CHAVES)[number], string>>) {
  for (const k of CHAVES) {
    if (valores[k] === undefined) delete process.env[k]
    else process.env[k] = valores[k]
  }
}

beforeEach(() => env({ INTERNAL_SECRET: 'interno-antigo' }))
afterEach(() => {
  for (const k of CHAVES) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})

describe('token de opt-out', () => {
  it('sem OPTOUT_SECRET, assina e valida com o INTERNAL_SECRET (comportamento anterior)', () => {
    const t = gerarTokenOptout(LEAD)
    expect(validarTokenOptout(LEAD, t)).toBe(true)
    expect(validarTokenOptout(OUTRO_LEAD, t)).toBe(false)
    expect(validarTokenOptout(LEAD, `${t}x`)).toBe(false)
    expect(validarTokenOptout('', t)).toBe(false)
    expect(validarTokenOptout(LEAD, '')).toBe(false)
  })

  it('com OPTOUT_SECRET, links novos não dependem do INTERNAL_SECRET', () => {
    env({ INTERNAL_SECRET: 'interno-antigo', OPTOUT_SECRET: 'optout-novo' })
    const t = gerarTokenOptout(LEAD)
    env({ INTERNAL_SECRET: 'interno-rotacionado', OPTOUT_SECRET: 'optout-novo' })
    expect(validarTokenOptout(LEAD, t)).toBe(true)
  })

  it('rotação: link antigo segue válido via OPTOUT_SECRET_LEGADO', () => {
    const tokenAntigo = gerarTokenOptout(LEAD) // assinado com o INTERNAL_SECRET de antes
    env({ INTERNAL_SECRET: 'interno-rotacionado', OPTOUT_SECRET: 'optout-novo', OPTOUT_SECRET_LEGADO: 'interno-antigo' })
    expect(validarTokenOptout(LEAD, tokenAntigo)).toBe(true)
    expect(validarTokenOptout(OUTRO_LEAD, tokenAntigo)).toBe(false)
    // O legado só valida: links novos saem com o OPTOUT_SECRET.
    expect(gerarTokenOptout(LEAD)).not.toBe(tokenAntigo)
    expect(validarTokenOptout(LEAD, gerarTokenOptout(LEAD))).toBe(true)
  })

  it('sem o legado configurado, link antigo deixa de valer após a rotação', () => {
    const tokenAntigo = gerarTokenOptout(LEAD)
    env({ INTERNAL_SECRET: 'interno-rotacionado', OPTOUT_SECRET: 'optout-novo' })
    expect(validarTokenOptout(LEAD, tokenAntigo)).toBe(false)
  })

  it('com OPTOUT_SECRET, o INTERNAL_SECRET não valida token', () => {
    env({ INTERNAL_SECRET: 'interno', OPTOUT_SECRET: 'optout-novo' })
    const assinadoComInterno = gerarTokenOptout(LEAD)
    env({ INTERNAL_SECRET: 'interno' })
    const soInterno = gerarTokenOptout(LEAD)
    env({ INTERNAL_SECRET: 'interno', OPTOUT_SECRET: 'optout-novo' })
    expect(validarTokenOptout(LEAD, assinadoComInterno)).toBe(true)
    expect(validarTokenOptout(LEAD, soInterno)).toBe(false)
  })

  it('sem nenhum segredo, gerar o link falha em vez de sair sem assinatura', () => {
    env({})
    expect(() => urlOptout(LEAD)).toThrow(/não configurado/)
  })
})
