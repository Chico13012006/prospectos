// Exclusão de campanha: ordem das operações, travas e isolamento por
// organização. O client Supabase falso registra cada operação (tabela, tipo e
// filtros) — service_role ignora RLS, então o isolamento depende de todo filtro
// carregar a organização da sessão.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { apagarCampanha, ErroExclusaoCampanha } from '../exclusaoServidor'
import { motivoBloqueioExclusao } from '../exclusao'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'

interface Operacao {
  tabela: string
  tipo: 'select' | 'update' | 'delete'
  filtros: [string, string, unknown][]
  payload?: unknown
}

interface Cenario {
  campanha?: { id: string; status: string; workflow_id: string | null } | null
  execucoes?: { id: string; status: string; campanha_id: string | null; workflow_id: string }[]
  outrasCampanhasNoWorkflow?: number
  configuracoes?: Record<string, unknown>
}

function filtro(op: Operacao, coluna: string, tipo = 'eq') {
  return op.filtros.find(([c, t]) => c === coluna && t === tipo)?.[2]
}

function fakeAdmin(cenario: Cenario) {
  const operacoes: Operacao[] = []

  const responder = (op: Operacao) => {
    if (op.tipo === 'delete') {
      const ids = (filtro(op, 'execucao_id', 'in') ?? filtro(op, 'id', 'in')) as string[] | undefined
      const porExecucao = op.tabela === 'workflow_execucao_eventos' ? 2 : 1
      return { data: null, error: null, count: ids ? ids.length * porExecucao : 1 }
    }
    if (op.tipo === 'update') return { data: null, error: null }
    if (op.tabela === 'campanhas') {
      if (filtro(op, 'id', 'neq') !== undefined) {
        const n = cenario.outrasCampanhasNoWorkflow ?? 0
        return { data: Array.from({ length: n }, (_, i) => ({ id: `outra-${i}` })), error: null }
      }
      return { data: cenario.campanha ?? null, error: null }
    }
    if (op.tabela === 'organizacoes') return { data: { configuracoes: cenario.configuracoes ?? {} }, error: null }
    if (op.tabela === 'workflow_execucoes') {
      const porCampanha = filtro(op, 'campanha_id')
      const porWorkflow = filtro(op, 'workflow_id')
      const linhas = (cenario.execucoes ?? []).filter((e) =>
        (porCampanha === undefined || e.campanha_id === porCampanha)
        && (porWorkflow === undefined || e.workflow_id === porWorkflow))
      return { data: linhas, error: null }
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
        delete: () => { op.tipo = 'delete'; return chain },
        eq: (c: string, v: unknown) => { op.filtros.push([c, 'eq', v]); return chain },
        neq: (c: string, v: unknown) => { op.filtros.push([c, 'neq', v]); return chain },
        in: (c: string, v: unknown) => { op.filtros.push([c, 'in', v]); return chain },
        order: () => chain,
        range: () => chain,
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

const mutacoes = (operacoes: Operacao[]) =>
  operacoes.filter((o) => o.tipo !== 'select').map((o) => `${o.tipo}:${o.tabela}`)

const concluidaComWorkflow = (): Cenario => ({
  campanha: { id: 'C1', status: 'concluida', workflow_id: 'W1' },
  execucoes: [
    { id: 'E1', status: 'concluido', campanha_id: 'C1', workflow_id: 'W1' },
    { id: 'E2', status: 'concluido', campanha_id: 'C1', workflow_id: 'W1' },
  ],
})

describe('apagarCampanha', () => {
  it('apaga eventos, execuções, o workflow exclusivo e por último a campanha', async () => {
    const { client, operacoes } = fakeAdmin(concluidaComWorkflow())

    const resultado = await apagarCampanha(client, ORG, 'C1')

    expect(resultado).toEqual({ execucoes: 2, eventos: 4, workflowApagado: true })
    expect(mutacoes(operacoes)).toEqual([
      'delete:workflow_execucao_eventos',
      'delete:workflow_execucoes',
      'update:workflows',
      'delete:workflow_versoes',
      'delete:workflows',
      'delete:campanhas',
    ])
    expect(operacoes.find((o) => o.tipo === 'update')?.payload).toEqual({ versao_atual_id: null })
  })

  it('toda leitura e escrita fica presa à organização da sessão', async () => {
    const { client, operacoes } = fakeAdmin(concluidaComWorkflow())

    await apagarCampanha(client, ORG, 'C1')

    for (const op of operacoes) {
      if (op.tabela === 'organizacoes') expect(filtro(op, 'id')).toBe(ORG)
      else expect(filtro(op, 'organizacao_id')).toBe(ORG)
      expect(op.filtros.some(([, , valor]) => valor === OUTRA)).toBe(false)
    }
  })

  it('campanha de outra organização ou inexistente → 404 sem apagar nada', async () => {
    const { client, operacoes } = fakeAdmin({ campanha: null })

    const erro = await apagarCampanha(client, ORG, 'C-de-outra-org').catch((e) => e)

    expect(erro).toBeInstanceOf(ErroExclusaoCampanha)
    expect(erro.status).toBe(404)
    expect(mutacoes(operacoes)).toEqual([])
  })

  it('recusa campanha ativa sem apagar nada', async () => {
    const { client, operacoes } = fakeAdmin({
      ...concluidaComWorkflow(),
      campanha: { id: 'C1', status: 'ativa', workflow_id: 'W1' },
    })

    await expect(apagarCampanha(client, ORG, 'C1')).rejects.toMatchObject({ status: 409 })
    expect(mutacoes(operacoes)).toEqual([])
  })

  it('recusa concluída com execução em andamento sem apagar nada', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'concluida', workflow_id: 'W1' },
      execucoes: [{ id: 'E1', status: 'em_andamento', campanha_id: 'C1', workflow_id: 'W1' }],
    })

    await expect(apagarCampanha(client, ORG, 'C1')).rejects.toMatchObject({ status: 409 })
    expect(mutacoes(operacoes)).toEqual([])
  })

  it('pausada com execução aguardando pode ser apagada', async () => {
    const { client, operacoes } = fakeAdmin({
      campanha: { id: 'C1', status: 'pausada', workflow_id: 'W1' },
      execucoes: [{ id: 'E1', status: 'aguardando', campanha_id: 'C1', workflow_id: 'W1' }],
    })

    await expect(apagarCampanha(client, ORG, 'C1')).resolves.toMatchObject({ execucoes: 1 })
    expect(mutacoes(operacoes)).toContain('delete:workflow_execucoes')
    expect(mutacoes(operacoes).at(-1)).toBe('delete:campanhas')
  })

  it('mantém o workflow usado por outra campanha', async () => {
    const { client, operacoes } = fakeAdmin({ ...concluidaComWorkflow(), outrasCampanhasNoWorkflow: 1 })

    const resultado = await apagarCampanha(client, ORG, 'C1')

    expect(resultado.workflowApagado).toBe(false)
    expect(mutacoes(operacoes)).toEqual([
      'delete:workflow_execucao_eventos',
      'delete:workflow_execucoes',
      'delete:campanhas',
    ])
  })

  it('mantém o workflow que tem execução de fora da campanha', async () => {
    const cenario = concluidaComWorkflow()
    cenario.execucoes!.push({ id: 'E3', status: 'concluido', campanha_id: null, workflow_id: 'W1' })
    const { client, operacoes } = fakeAdmin(cenario)

    const resultado = await apagarCampanha(client, ORG, 'C1')

    expect(resultado).toEqual({ execucoes: 2, eventos: 4, workflowApagado: false })
    expect(mutacoes(operacoes)).not.toContain('delete:workflows')
    expect(filtro(operacoes.find((o) => o.tabela === 'workflow_execucoes' && o.tipo === 'delete')!, 'id', 'in'))
      .toEqual(['E1', 'E2'])
  })

  it('rascunho sem execuções nem workflow apaga só a campanha', async () => {
    const { client, operacoes } = fakeAdmin({ campanha: { id: 'C1', status: 'rascunho', workflow_id: null } })

    const resultado = await apagarCampanha(client, ORG, 'C1')

    expect(resultado).toEqual({ execucoes: 0, eventos: 0, workflowApagado: false })
    expect(mutacoes(operacoes)).toEqual(['delete:campanhas'])
  })

  it('recusa a campanha de retorno do handoff comercial sem apagar nada', async () => {
    const { client, operacoes } = fakeAdmin({
      ...concluidaComWorkflow(),
      configuracoes: { comercial: { campanhaRetornoId: 'C1' } },
    })

    await expect(apagarCampanha(client, ORG, 'C1')).rejects.toMatchObject({ status: 409 })
    expect(mutacoes(operacoes)).toEqual([])
  })
})

describe('motivoBloqueioExclusao', () => {
  it('campanha ativa nunca pode ser apagada', () => {
    expect(motivoBloqueioExclusao('ativa', 0)).toMatch(/Pause/)
  })

  it('concluída só sai sem execução em andamento', () => {
    expect(motivoBloqueioExclusao('concluida', 2)).toMatch(/2 execução/)
    expect(motivoBloqueioExclusao('concluida', 0)).toBeNull()
  })

  it('pausada e rascunho saem mesmo com pendência: nada as processa', () => {
    expect(motivoBloqueioExclusao('pausada', 3)).toBeNull()
    expect(motivoBloqueioExclusao('rascunho', 1)).toBeNull()
  })
})
