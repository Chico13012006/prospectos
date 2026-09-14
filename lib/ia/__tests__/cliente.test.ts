import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SDKs falsos: estes testes só leem variáveis de ambiente; nenhum client é criado.
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))
vi.mock('openai', () => ({ default: class {} }))

import { iaConfigurada } from '../cliente'

const VARIAVEIS = ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const
type Variavel = (typeof VARIAVEIS)[number]
const originais = new Map<Variavel, string | undefined>()

function definirEnv(nome: Variavel, valor: string | undefined) {
  if (valor === undefined) delete process.env[nome]
  else process.env[nome] = valor
}

beforeEach(() => {
  for (const nome of VARIAVEIS) {
    originais.set(nome, process.env[nome])
    definirEnv(nome, undefined)
  }
})

afterEach(() => {
  for (const nome of VARIAVEIS) definirEnv(nome, originais.get(nome))
})

describe('iaConfigurada — segue o provider ativo', () => {
  it('anthropic com ANTHROPIC_API_KEY → configurada', () => {
    definirEnv('AI_PROVIDER', 'anthropic')
    definirEnv('ANTHROPIC_API_KEY', 'chave-falsa-anthropic')
    expect(iaConfigurada()).toBe(true)
  })

  it('anthropic sem ANTHROPIC_API_KEY → não configurada, mesmo com a chave da OpenAI', () => {
    definirEnv('AI_PROVIDER', 'anthropic')
    definirEnv('OPENAI_API_KEY', 'chave-falsa-openai')
    expect(iaConfigurada()).toBe(false)
  })

  it('openai com OPENAI_API_KEY → configurada, sem depender da chave da Anthropic', () => {
    definirEnv('AI_PROVIDER', 'openai')
    definirEnv('OPENAI_API_KEY', 'chave-falsa-openai')
    expect(iaConfigurada()).toBe(true)
  })

  it('openai sem OPENAI_API_KEY → não configurada, mesmo com a chave da Anthropic (sem fallback)', () => {
    definirEnv('AI_PROVIDER', 'openai')
    definirEnv('ANTHROPIC_API_KEY', 'chave-falsa-anthropic')
    expect(iaConfigurada()).toBe(false)
  })

  it('AI_PROVIDER ausente mantém o legado: só a chave da Anthropic conta', () => {
    definirEnv('OPENAI_API_KEY', 'chave-falsa-openai')
    expect(iaConfigurada()).toBe(false)
    definirEnv('ANTHROPIC_API_KEY', 'chave-falsa-anthropic')
    expect(iaConfigurada()).toBe(true)
  })

  it('AI_PROVIDER inválido lança erro explícito, sem expor chaves', () => {
    definirEnv('AI_PROVIDER', 'open-ai')
    definirEnv('ANTHROPIC_API_KEY', 'chave-falsa-anthropic')
    definirEnv('OPENAI_API_KEY', 'chave-falsa-openai')

    let erro: unknown
    try {
      iaConfigurada()
    } catch (e) {
      erro = e
    }
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).toContain('AI_PROVIDER inválido')
    expect((erro as Error).message).not.toContain('chave-falsa')
  })
})
