// Gravação da edição de mensagens: templates e público atualizados, nada
// gravado quando algo falha antes, e toda operação presa à organização. O
// client Supabase falso registra tabela, tipo e filtros de cada operação.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { editarMensagensCampanha, ErroEdicaoMensagens } from '../edicaoMensagensServidor'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'

interface Operacao {
  tabela: string
  tipo: 'select' | 'update'
  filtros: [string, string, unknown][]
  payload?: unknown
}

interface Cenario {
  campanha?: { id: string; status: string; publico: unknown } | null
  templatesExistentes?: string[]
}

function filtro(op: Operacao, coluna: string, tipo = 'eq') {
  return op.filtros.find(([c, t]) => c === coluna && t === tipo)?.[2]
}

function fakeAdmin(cenario: Cenario) {
  const operacoes: Operacao[] = []
  const responder = (op: Operacao) => {
    if (op.tipo === 'update') return { data: null, error: null }
    if (op.tabela === 'campanhas') return { data: cenario.campanha ?? null, error: null }
    if (op.tabela === 'templates') {
      const tipo = filtro(op, 'tipo') as string
      return { data: (cenario.templatesExistentes ?? []).includes(tipo) ? [{ id: `id-${tipo}` }] : [], error: null }
    }
    return { data: null, error: null }
  }
  const client = {
    from(tabela: string) {
      const op: Operacao = { tabela, tipo: 'select', filtros: [] }
      operacoes.push(op)
      const chain = {
        select: () => chain,
        update: (payload: unknown) => { op.tipo = 'update'; op.payload = payload; return chain },
        eq: (c: string, v: unknown) => { op.filtros.push([c, 'eq', v]); return chain },
        is: (c: string, v: unknown) => { op.filtros.push([c, 'is', v]); return chain },
        limit: () => chain,
        maybeSingle: () => chain,
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(responder(op)).then(resolve, reject),
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { client, operacoes }
}

const publico = () => ({
  operacao: {
    mensagemInicial: { assunto: 'A1', corpo: 'C1', templateTipo: 'campanha_c1_m1' },
    followups: [{ assunto: 'A2', corpo: 'C2', templateTipo: 'campanha_c1_m2', diasApos: 3 }],
  },
})

const edicao = () => ({
  mensagemInicial: { assunto: 'Novo 1', corpo: 'Olá {{nome}}', html: '<p>Olá {{nome}}</p>' },
  followups: [{ assunto: 'Novo 2', corpo: 'De novo' }],
})

const ambosTemplates = ['campanha_c1_m1', 'campanha_c1_m2']
const escritas = (operacoes: Operacao[]) =>
  operacoes.filter((o) => o.tipo === 'update').map((o) => `${o.tabela}:${filtro(o, 'tipo') ?? filtro(o, 'id')}`)

describe('editarMensagensCampanha', () => {
  it('atualiza os templates pelo tipo e depois o público da campanha', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'ativa', publico: publico() },
      templatesExistentes: ambosTemplates,
    })

    await expect(editarMensagensCampanha(client, ORG, 'C1', edicao())).resolves.toEqual({ mensagens: 2 })

    expect(escritas(operacoes)).toEqual(['templates:campanha_c1_m1', 'templates:campanha_c1_m2', 'campanhas:C1'])
    const [primeiroTemplate] = operacoes.filter((o) => o.tabela === 'templates' && o.tipo === 'update')
    expect(primeiroTemplate.payload).toEqual({ assunto: 'Novo 1', corpo: 'Olá {{nome}}' })
    expect(primeiroTemplate.filtros).toContainEqual(['canal', 'eq', 'email'])
    expect(primeiroTemplate.filtros).toContainEqual(['nicho', 'is', null])
    const campanha = operacoes.find((o) => o.tabela === 'campanhas' && o.tipo === 'update')!
    const gravado = (campanha.payload as { publico: { operacao: { mensagemInicial: object; followups: object[] } } }).publico
    expect(gravado.operacao.mensagemInicial).toMatchObject({ html: '<p>Olá {{nome}}</p>', templateTipo: 'campanha_c1_m1' })
    expect(gravado.operacao.followups[0]).toMatchObject({ assunto: 'Novo 2', diasApos: 3 })
  })

  it('toda leitura e escrita fica presa à organização da sessão', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'pausada', publico: publico() },
      templatesExistentes: ambosTemplates,
    })

    await editarMensagensCampanha(client, ORG, 'C1', edicao())

    for (const op of operacoes) {
      expect(filtro(op, 'organizacao_id')).toBe(ORG)
      expect(op.filtros.some(([, , valor]) => valor === OUTRA)).toBe(false)
    }
  })

  it('campanha de outra organização ou inexistente → 404 sem gravar', async () => {
    const { client, operacoes } = fakeAdmin({ campanha: null, templatesExistentes: ambosTemplates })

    const erro = await editarMensagensCampanha(client, ORG, 'C-de-outra-org', edicao()).catch((e) => e)

    expect(erro).toBeInstanceOf(ErroEdicaoMensagens)
    expect(erro.status).toBe(404)
    expect(escritas(operacoes)).toEqual([])
  })

  it.each(['rascunho', 'concluida'])('campanha %s → 409 sem gravar', async (status) => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status, publico: publico() },
      templatesExistentes: ambosTemplates,
    })

    await expect(editarMensagensCampanha(client, ORG, 'C1', edicao())).rejects.toMatchObject({ status: 409 })
    expect(escritas(operacoes)).toEqual([])
  })

  it('edição inválida → 400 sem gravar', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'ativa', publico: publico() },
      templatesExistentes: ambosTemplates,
    })

    await expect(editarMensagensCampanha(client, ORG, 'C1', { ...edicao(), followups: [] }))
      .rejects.toMatchObject({ status: 400 })
    expect(escritas(operacoes)).toEqual([])
  })

  it('template ausente → 409 antes de gravar qualquer coisa', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'ativa', publico: publico() },
      templatesExistentes: ['campanha_c1_m1'],
    })

    await expect(editarMensagensCampanha(client, ORG, 'C1', edicao()))
      .rejects.toThrow('O template do follow-up 1 não foi encontrado.')
    expect(escritas(operacoes)).toEqual([])
  })
})
