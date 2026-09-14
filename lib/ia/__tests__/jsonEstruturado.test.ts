import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openAiCreate: vi.fn(),
}))

// SDKs falsos: nenhum teste sai para a rede nem usa chave real.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.anthropicCreate }
  },
}))
vi.mock('openai', () => ({
  default: class {
    responses = { create: mocks.openAiCreate }
  },
}))

import { MODELO_COPILOTO, MODELO_INSIGHT, MODELO_OPENAI, resolverProvedorIa } from '../cliente'
import {
  ErroJsonEstruturado,
  FOLGA_RACIOCINIO_OPENAI,
  gerarJsonEstruturado,
  type PedidoJsonEstruturado,
} from '../jsonEstruturado'

const VARIAVEIS = ['AI_PROVIDER', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL'] as const
type Variavel = (typeof VARIAVEIS)[number]
const originais = new Map<Variavel, string | undefined>()

function definirEnv(nome: Variavel, valor: string | undefined) {
  if (valor === undefined) delete process.env[nome]
  else process.env[nome] = valor
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nota: { type: 'string', enum: ['alta', 'baixa'] },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { nome: { type: 'string' } },
        required: ['nome'],
      },
    },
  },
  required: ['nota', 'itens'],
}

const PEDIDO: PedidoJsonEstruturado = {
  papel: 'insight',
  system: 'Sistema de teste.',
  user: 'Entrada de teste.',
  schema: SCHEMA,
  nomeSchema: 'teste_estruturado',
  maxTokens: 700,
}

const JSON_VALIDO = '{"nota":"alta","itens":[{"nome":"coletor"}]}'
const OBJETO_VALIDO = { nota: 'alta', itens: [{ nome: 'coletor' }] }

const texto = (t: string) => ({ type: 'output_text', text: t, annotations: [] })
const raciocinio = { id: 'rs_teste', type: 'reasoning', summary: [] }

function mensagem(content: unknown[], phase?: 'commentary' | 'final_answer') {
  return { id: 'msg_teste', type: 'message', role: 'assistant', status: 'completed', content, ...(phase ? { phase } : {}) }
}

function respostaOpenAi(extra: Record<string, unknown> = {}) {
  return {
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [raciocinio, mensagem([texto(JSON_VALIDO)])],
    ...extra,
  }
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroJsonEstruturado> {
  const erro = await promessa.then(() => null, (e: unknown) => e)
  expect(erro).toBeInstanceOf(ErroJsonEstruturado)
  return erro as ErroJsonEstruturado
}

beforeEach(() => {
  for (const nome of VARIAVEIS) originais.set(nome, process.env[nome])
  definirEnv('AI_PROVIDER', undefined)
  definirEnv('ANTHROPIC_API_KEY', 'chave-falsa-anthropic')
  definirEnv('OPENAI_API_KEY', 'chave-falsa-openai')
  mocks.anthropicCreate.mockReset()
  mocks.openAiCreate.mockReset()
})

afterEach(() => {
  for (const nome of VARIAVEIS) definirEnv(nome, originais.get(nome))
})

describe('resolverProvedorIa', () => {
  it('sem AI_PROVIDER (ausente ou vazia) usa anthropic — deploy sem configuração não muda', () => {
    expect(resolverProvedorIa()).toBe('anthropic')
    definirEnv('AI_PROVIDER', '  ')
    expect(resolverProvedorIa()).toBe('anthropic')
  })

  it('seleciona anthropic ou openai explicitamente, sem diferenciar maiúsculas', () => {
    definirEnv('AI_PROVIDER', 'anthropic')
    expect(resolverProvedorIa()).toBe('anthropic')
    definirEnv('AI_PROVIDER', 'openai')
    expect(resolverProvedorIa()).toBe('openai')
    definirEnv('AI_PROVIDER', ' OpenAI ')
    expect(resolverProvedorIa()).toBe('openai')
  })

  it('valor desconhecido falha em vez de escolher um provider em silêncio', async () => {
    definirEnv('AI_PROVIDER', 'open-ai')
    expect(() => resolverProvedorIa()).toThrow('AI_PROVIDER inválido')
    await expect(gerarJsonEstruturado(PEDIDO)).rejects.toThrow('AI_PROVIDER inválido')
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
    expect(mocks.openAiCreate).not.toHaveBeenCalled()
  })
})

describe('gerarJsonEstruturado — Anthropic', () => {
  it('sem AI_PROVIDER faz a mesma chamada de antes no SDK Anthropic e devolve o JSON', async () => {
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON_VALIDO }] })

    await expect(gerarJsonEstruturado(PEDIDO)).resolves.toEqual(OBJETO_VALIDO)
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1)
    expect(mocks.anthropicCreate).toHaveBeenCalledWith({
      model: MODELO_INSIGHT,
      max_tokens: 700,
      system: 'Sistema de teste.',
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: 'Entrada de teste.' }],
    })
    expect(mocks.openAiCreate).not.toHaveBeenCalled()
  })

  it('AI_PROVIDER=anthropic usa o modelo do papel', async () => {
    definirEnv('AI_PROVIDER', 'anthropic')
    mocks.anthropicCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON_VALIDO }] })

    await gerarJsonEstruturado({ ...PEDIDO, papel: 'copiloto' })
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({ model: MODELO_COPILOTO }))
    expect(mocks.openAiCreate).not.toHaveBeenCalled()
  })

  it('mantém a leitura legada: sem bloco de texto devolve {}', async () => {
    mocks.anthropicCreate.mockResolvedValue({ content: [] })
    await expect(gerarJsonEstruturado(PEDIDO)).resolves.toEqual({})
  })

  it('sem ANTHROPIC_API_KEY falha com erro claro, sem chamar a API', async () => {
    definirEnv('ANTHROPIC_API_KEY', undefined)
    await expect(gerarJsonEstruturado(PEDIDO)).rejects.toThrow('ANTHROPIC_API_KEY não configurada')
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })
})

describe('gerarJsonEstruturado — OpenAI', () => {
  beforeEach(() => definirEnv('AI_PROVIDER', 'openai'))

  it('usa a Responses API com JSON Schema estrito e folga de raciocínio', async () => {
    mocks.openAiCreate.mockResolvedValue(respostaOpenAi())

    await expect(gerarJsonEstruturado(PEDIDO)).resolves.toEqual(OBJETO_VALIDO)
    expect(mocks.openAiCreate).toHaveBeenCalledTimes(1)
    expect(mocks.openAiCreate).toHaveBeenCalledWith({
      model: MODELO_OPENAI,
      instructions: 'Sistema de teste.',
      input: 'Entrada de teste.',
      max_output_tokens: 700 + FOLGA_RACIOCINIO_OPENAI,
      text: { format: { type: 'json_schema', name: 'teste_estruturado', schema: SCHEMA, strict: true } },
      store: false,
    })
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('folga de raciocínio cresce com o limite visível de cada funcionalidade', async () => {
    const casos = [
      ['insight', 200, 4200], // classificador de respostas
      ['insight', 500, 4500], // contatos alternativos
      ['insight', 700, 4700], // inteligência comercial
      ['copiloto', 6000, 18000], // copiloto pós-reunião
    ] as const
    for (const [papel, maxTokens, esperado] of casos) {
      mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi())
      await gerarJsonEstruturado({ ...PEDIDO, papel, maxTokens })
      expect(mocks.openAiCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: MODELO_OPENAI, max_output_tokens: esperado }),
      )
    }
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('ignora raciocínio e mensagem de commentary; lê só a resposta final', async () => {
    mocks.openAiCreate.mockResolvedValue(respostaOpenAi({
      output: [
        mensagem([texto('Analisando o lead...')], 'commentary'),
        raciocinio,
        mensagem([texto(JSON_VALIDO)], 'final_answer'),
      ],
    }))
    await expect(gerarJsonEstruturado(PEDIDO)).resolves.toEqual(OBJETO_VALIDO)
  })

  it('recusa vira erro explícito, sem copiar o texto do modelo na mensagem', async () => {
    mocks.openAiCreate.mockResolvedValue(respostaOpenAi({
      output: [mensagem([{ type: 'refusal', refusal: 'Texto de recusa do modelo' }])],
    }))
    const erro = await erroDe(gerarJsonEstruturado(PEDIDO))
    expect(erro.motivo).toBe('recusa')
    expect(erro.message).not.toContain('Texto de recusa do modelo')
  })

  it.each([
    ['texto que parece JSON válido', JSON_VALIDO],
    ['JSON cortado', '{"nota":"al'],
  ])('resposta incompleta é rejeitada (%s)', async (_caso, parcial) => {
    mocks.openAiCreate.mockResolvedValue(respostaOpenAi({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [raciocinio, mensagem([texto(parcial)])],
    }))
    const erro = await erroDe(gerarJsonEstruturado(PEDIDO))
    expect(erro.motivo).toBe('incompleta')
    expect(erro.message).toContain('max_output_tokens')
  })

  it('erro da API ou status não concluído falham explicitamente', async () => {
    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({
      status: 'failed',
      error: { code: 'server_error', message: 'falha simulada' },
    }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('falha')

    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({ status: 'in_progress' }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('falha')
  })

  it('sem texto utilizável é erro claro', async () => {
    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({ output: [raciocinio] }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('sem_texto')

    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({ output: [mensagem([texto('   ')])] }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('sem_texto')
  })

  it('JSON inválido ou que não é objeto não passa', async () => {
    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({ output: [mensagem([texto('{nota: alta}')])] }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('json_invalido')

    mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi({ output: [mensagem([texto('["alta"]')])] }))
    expect((await erroDe(gerarJsonEstruturado(PEDIDO))).motivo).toBe('json_invalido')
  })

  it('schema não estrito é recusado antes de chamar a API', async () => {
    const semAdditionalProperties = {
      ...SCHEMA,
      properties: {
        ...SCHEMA.properties,
        itens: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] } },
      },
    }
    const campoForaDeRequired = { ...SCHEMA, required: ['nota'] }

    for (const schema of [semAdditionalProperties, campoForaDeRequired]) {
      const erro = await erroDe(gerarJsonEstruturado({ ...PEDIDO, schema }))
      expect(erro.motivo).toBe('schema_nao_estrito')
    }
    expect(mocks.openAiCreate).not.toHaveBeenCalled()
  })

  it('sem OPENAI_API_KEY falha com erro claro, sem chamar nenhum provider', async () => {
    definirEnv('OPENAI_API_KEY', undefined)
    await expect(gerarJsonEstruturado(PEDIDO)).rejects.toThrow('OPENAI_API_KEY não configurada')
    expect(mocks.openAiCreate).not.toHaveBeenCalled()
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('erro do SDK propaga sem fallback para a Anthropic', async () => {
    mocks.openAiCreate.mockRejectedValue(new Error('falha de rede simulada'))
    await expect(gerarJsonEstruturado(PEDIDO)).rejects.toThrow('falha de rede simulada')
    expect(mocks.anthropicCreate).not.toHaveBeenCalled()
  })

  it('modelo vem de OPENAI_MODEL, com gpt-5.6-luna quando ausente', async () => {
    const casos = [['modelo-openai-teste', 'modelo-openai-teste'], [undefined, 'gpt-5.6-luna']] as const
    for (const [valor, esperado] of casos) {
      definirEnv('OPENAI_MODEL', valor)
      vi.resetModules()
      const camada = await import('../jsonEstruturado')
      mocks.openAiCreate.mockResolvedValueOnce(respostaOpenAi())
      await camada.gerarJsonEstruturado(PEDIDO)
      expect(mocks.openAiCreate).toHaveBeenLastCalledWith(expect.objectContaining({ model: esperado }))
    }
  })
})
