import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  gerarJsonEstruturado: vi.fn(),
  iaConfigurada: vi.fn(),
}))

// Só a chamada ao provider é substituída: aqui importa O QUE o copiloto envia,
// como normaliza a resposta e como a rota traduz falhas, independentemente do provider.
vi.mock('../jsonEstruturado', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../jsonEstruturado')>()),
  gerarJsonEstruturado: mocks.gerarJsonEstruturado,
}))
vi.mock('../cliente', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cliente')>()),
  iaConfigurada: mocks.iaConfigurada,
}))
// Sessão e organização falsas para a rota: nenhum Supabase real.
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'usuario-teste' } } }) },
  }),
}))
vi.mock('@/lib/supabase-admin', () => {
  type Consulta = { select: () => Consulta; eq: () => Consulta; maybeSingle: () => Promise<unknown> }
  const consulta: Consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => ({ data: { organizacao_id: 'org-teste' }, error: null }),
  }
  return { createSupabaseAdminClient: () => ({ from: () => consulta }) }
})

import { analisarReuniao, montarPromptAnalise, type ContextoLeadCopiloto } from '../copilotoReuniao'
import { ErroJsonEstruturado } from '../jsonEstruturado'
import { POST, maxDuration } from '@/app/api/copiloto/route'

// Cópia literal do schema de 12 campos de antes da migração: se mudar, quebra.
const SCHEMA_ORIGINAL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resumo: { type: 'string' },
    dores: { type: 'array', items: { type: 'string' } },
    necessidades: { type: 'array', items: { type: 'string' } },
    objecoes: { type: 'array', items: { type: 'string' } },
    equipamentos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          produto: { type: 'string', enum: ['coletor', 'impressora', 'totem', 'pdv', 'mesa_rfid'] },
          quantidade: { type: 'integer' },
          origem: { type: 'string', enum: ['mencionado', 'recomendado'] },
          justificativa: { type: 'string' },
        },
        required: ['produto', 'quantidade', 'origem', 'justificativa'],
      },
    },
    lacunasDescoberta: { type: 'array', items: { type: 'string' } },
    proximosPassos: { type: 'array', items: { type: 'string' } },
    tarefas: { type: 'array', items: { type: 'string' } },
    estagioSugerido: {
      type: 'string',
      enum: ['interessado', 'reuniao_agendada', 'com_closer', 'ganho', 'perdido', 'follow_up', ''],
    },
    proximoFollowup: { type: 'string' },
    emailAssunto: { type: 'string' },
    emailCorpo: { type: 'string' },
  },
  required: [
    'resumo', 'dores', 'necessidades', 'objecoes', 'lacunasDescoberta', 'equipamentos',
    'proximosPassos', 'tarefas', 'estagioSugerido', 'proximoFollowup',
    'emailAssunto', 'emailCorpo',
  ],
}

const CONTEXTO: ContextoLeadCopiloto = {
  empresa: 'Ótica Exemplo',
  segmento: 'Varejo',
  cidade: 'Campinas',
  estado: 'SP',
  contato: 'Contato Fictício',
  cargo: 'Gerente de operações',
  estagioAtual: 'reuniao_agendada',
  historico: [
    { tipo: 'nota', canal: 'sistema', descricao: 'Primeiro contato registrado.', realizadaEm: '2026-09-10T12:00:00.000Z' },
  ],
}
const TRANSCRICAO = 'Cliente relatou inventário manual em 3 lojas e perdas frequentes de armações.'

beforeEach(() => {
  mocks.gerarJsonEstruturado.mockReset()
  mocks.gerarJsonEstruturado.mockResolvedValue({ resumo: 'ok' })
})

describe('analisarReuniao — via camada central de IA', () => {
  it('envia o prompt montado (contexto, histórico e transcrição), o schema de 12 campos e o limite de antes', async () => {
    await analisarReuniao(TRANSCRICAO, CONTEXTO)

    const esperado = montarPromptAnalise(TRANSCRICAO, CONTEXTO)
    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledTimes(1)
    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledWith({
      papel: 'copiloto',
      system: esperado.system,
      user: esperado.user,
      schema: SCHEMA_ORIGINAL,
      nomeSchema: 'analise_reuniao',
      maxTokens: 6000,
    })
    expect(esperado.system).toContain('[CONHECIMENTO INOVACODE]')
    expect(esperado.system).toContain('[PLAYBOOK COMERCIAL INOVACODE]')
    expect(esperado.user).toContain('Primeiro contato registrado.')
    expect(esperado.user).toContain(`[TRANSCRIÇÃO DA REUNIÃO ATUAL]\n${TRANSCRICAO}`)
  })

  it('sem lead selecionado envia o prompt sem contexto', async () => {
    await analisarReuniao(TRANSCRICAO)
    expect(mocks.gerarJsonEstruturado.mock.calls[0][0].user).toBe(montarPromptAnalise(TRANSCRICAO).user)
  })

  it('aplica normalizarAnalise à resposta da camada', async () => {
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({
      resumo: '  Operação com inventário manual.  ',
      dores: ['1', '2', '3', '4', '5'],
      equipamentos: [
        { produto: 'coletor', quantidade: 2, origem: 'mencionado', justificativa: 'Citado.' },
        { produto: 'drone', quantidade: 1, origem: 'recomendado', justificativa: 'Fora do vocabulário.' },
        { produto: 'impressora', quantidade: 0, origem: 'recomendado', justificativa: 'Validar CD.' },
      ],
      estagioSugerido: 'fechado_amanha',
      emailAssunto: 'Próximos passos',
    })

    const analise = await analisarReuniao(TRANSCRICAO, CONTEXTO)
    expect(analise.resumo).toBe('Operação com inventário manual.')
    expect(analise.dores).toEqual(['1', '2', '3', '4'])
    expect(analise.equipamentos).toEqual([
      { produto: 'coletor', quantidade: 2, origem: 'mencionado', justificativa: 'Citado.' },
      { produto: 'impressora', quantidade: 1, origem: 'recomendado', justificativa: 'Validar CD.' },
    ])
    expect(analise.estagioSugerido).toBeNull()
    expect(analise.necessidades).toEqual([])
    expect(analise.emailAssunto).toBe('Próximos passos')
    expect(analise.emailCorpo).toBe('')
  })

  it('falha da camada propaga (a rota responde 500)', async () => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('Resposta da OpenAI incompleta (max_output_tokens).'))
    await expect(analisarReuniao(TRANSCRICAO, CONTEXTO)).rejects.toThrow('incompleta')
  })
})

describe('rota /api/copiloto — maxDuration e tradução neutra de falhas da IA', () => {
  const pedido = () =>
    new NextRequest('http://localhost/api/copiloto', { method: 'POST', body: JSON.stringify({ transcricao: TRANSCRICAO }) })
  const erroComStatus = (status: number) => Object.assign(new Error('Erro simulado do provider'), { status })
  const DETALHE_INTERNO = /API_KEY|ANTHROPIC|OPENAI|Bearer|sk-/i

  beforeEach(() => {
    mocks.iaConfigurada.mockReset()
    mocks.iaConfigurada.mockReturnValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserva maxDuration = 60', () => {
    expect(maxDuration).toBe(60)
  })

  it('sucesso devolve a análise normalizada', async () => {
    const resp = await POST(pedido())
    expect(resp.status).toBe(200)
    expect((await resp.json()).analise.resumo).toBe('ok')
  })

  it.each([
    [401, 503, 'Chave da IA inválida ou revogada.'],
    [403, 503, 'Chave da IA inválida ou revogada.'],
    [429, 429, 'Limite de uso da IA atingido. Tente novamente em alguns instantes.'],
    [400, 500, 'A IA recusou a requisição.'],
    [500, 500, 'A IA recusou a requisição.'],
  ] as const)('erro do provider com status %i → HTTP %i e mensagem neutra', async (statusProvider, statusHttp, mensagem) => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(erroComStatus(statusProvider))
    const resp = await POST(pedido())
    const corpo = await resp.json()
    expect(resp.status).toBe(statusHttp)
    expect(corpo).toEqual({ erro: mensagem })
    expect(JSON.stringify(corpo)).not.toMatch(DETALHE_INTERNO)
  })

  it('falha validada pela camada (recusa/incompleta) → "A IA recusou a requisição."', async () => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(
      new ErroJsonEstruturado('incompleta', 'Resposta da OpenAI incompleta (max_output_tokens).'),
    )
    const resp = await POST(pedido())
    expect(resp.status).toBe(500)
    expect(await resp.json()).toEqual({ erro: 'A IA recusou a requisição.' })
  })

  it('erro desconhecido mantém a mensagem genérica', async () => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('falha inesperada'))
    const resp = await POST(pedido())
    expect(resp.status).toBe(500)
    expect(await resp.json()).toEqual({ erro: 'Erro ao analisar a reunião.' })
  })

  it('IA não configurada → 503 neutro, sem nome de variável, sem chamar a IA', async () => {
    mocks.iaConfigurada.mockReturnValue(false)
    const resp = await POST(pedido())
    const corpo = await resp.json()
    expect(resp.status).toBe(503)
    expect(corpo).toEqual({ erro: 'IA não configurada.' })
    expect(JSON.stringify(corpo)).not.toMatch(DETALHE_INTERNO)
    expect(mocks.gerarJsonEstruturado).not.toHaveBeenCalled()
  })
})
