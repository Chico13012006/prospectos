// Isolamento multi-tenant no NÍVEL DO CÓDIGO do WorkflowStore. service_role
// bypassa a RLS, então o isolamento deste caminho depende de o Store SEMPRE
// filtrar/gravar organizacao_id. Provado com um client Supabase falso que
// registra os .eq() e os payloads de insert. (O isolamento por RLS de verdade,
// com 2 orgs, é testado à parte no Supabase — ver scripts/workflows-isolamento.ts.)
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseWorkflowStore } from '../store/supabaseStore'

const ORG = 'org-aaaa'

class MockChain {
  eqCalls: [string, unknown][] = []
  insertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(private result: { data?: unknown; count?: number } = { data: [] }) {}
  select() { return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  insert(row: Record<string, unknown>) { this.insertPayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in() { return this }
  order() { return this }
  limit() { return this }
  single() { return this }
  maybeSingle() { return this }
  then(resolve: (v: unknown) => void) {
    resolve({ data: this.result.data ?? [], error: null, count: this.result.count ?? 0 })
  }
  temEq(col: string, val: unknown) {
    return this.eqCalls.some(([c, v]) => c === col && v === val)
  }
}

function mockClient() {
  const chains: Record<string, MockChain> = {}
  const client = {
    from(table: string) {
      const c = new MockChain({ data: [{ numero: 0 }] })
      chains[table] = c // guarda o ÚLTIMO chain daquela tabela
      return c
    },
  } as unknown as SupabaseClient
  return { client, chains }
}

const store = (client: SupabaseClient) => new SupabaseWorkflowStore(ORG, client)

describe('multi-tenant — SupabaseWorkflowStore filtra/grava organizacao_id', () => {
  it('exige organizacaoId no construtor', () => {
    expect(() => new SupabaseWorkflowStore('', mockClient().client)).toThrow()
    expect(store(mockClient().client).organizacaoId).toBe(ORG)
  })

  it('criarWorkflow GRAVA organizacao_id', async () => {
    const { client, chains } = mockClient()
    await store(client).criarWorkflow({ nome: 'W' })
    expect(chains.workflows.insertPayload?.organizacao_id).toBe(ORG)
  })

  it('buscarWorkflow filtra por organizacao_id (além do id)', async () => {
    const { client, chains } = mockClient()
    await store(client).buscarWorkflow('W1')
    expect(chains.workflows.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.workflows.temEq('id', 'W1')).toBe(true)
  })

  it('atualizarWorkflow filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await store(client).atualizarWorkflow('W1', { status: 'publicado' })
    expect(chains.workflows.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.workflows.temEq('id', 'W1')).toBe(true)
  })

  it('criarVersao GRAVA organizacao_id', async () => {
    const { client, chains } = mockClient()
    await store(client).criarVersao({ workflow_id: 'W1', numero: 1, definicao: { gatilho: { tipo: 'g', config: {} }, condicoes: [], acoes: [] } })
    expect(chains.workflow_versoes.insertPayload?.organizacao_id).toBe(ORG)
  })

  it('proximoNumeroVersao filtra por organizacao_id + workflow', async () => {
    const { client, chains } = mockClient()
    await store(client).proximoNumeroVersao('W1')
    expect(chains.workflow_versoes.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.workflow_versoes.temEq('workflow_id', 'W1')).toBe(true)
  })

  it('criarExecucao GRAVA organizacao_id e fixa versao_id', async () => {
    const { client, chains } = mockClient()
    await store(client).criarExecucao({ workflow_id: 'W1', versao_id: 'V1' })
    expect(chains.workflow_execucoes.insertPayload?.organizacao_id).toBe(ORG)
    expect(chains.workflow_execucoes.insertPayload?.versao_id).toBe('V1')
  })

  it('registrarEvento GRAVA organizacao_id', async () => {
    const { client, chains } = mockClient()
    await store(client).registrarEvento({ execucao_id: 'E1', tipo: 'execucao_iniciada' })
    expect(chains.workflow_execucao_eventos.insertPayload?.organizacao_id).toBe(ORG)
  })

  it('listarEventos filtra por organizacao_id + execucao', async () => {
    const { client, chains } = mockClient()
    await store(client).listarEventos('E1')
    expect(chains.workflow_execucao_eventos.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.workflow_execucao_eventos.temEq('execucao_id', 'E1')).toBe(true)
  })
})
