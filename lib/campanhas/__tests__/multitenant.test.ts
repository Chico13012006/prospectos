// Isolamento multi-tenant de `campanhas` no NÍVEL DO CÓDIGO. service_role bypassa
// a RLS, então o isolamento depende de SEMPRE escopar organizacao_id. Provado com
// client Supabase falso que registra .eq() e payloads. (RLS de verdade com 2 orgs
// = E2E à parte; service_role não passa por RLS.)
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listarCampanhas, criarCampanha, atualizarCampanha, buscarCampanha, transicaoPermitida } from '../repository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'

class Chain {
  eqCalls: [string, unknown][] = []
  insertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(public table: string, private result: unknown = []) {}
  select() { return this }
  insert(row: Record<string, unknown>) { this.insertPayload = row; return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  order() { return this }
  limit() { return this }
  single() { return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) {
    resolve({ data: this.insertPayload ? { id: 'C1' } : this.result, error: null })
  }
}
function mockClient(statusAtual = 'rascunho') {
  const chains: Chain[] = []
  const client = {
    from(table: string) {
      // p/ a leitura de status na transição, devolve o status atual
      const c = new Chain(table, { status: statusAtual, iniciada_em: null })
      chains.push(c)
      return c
    },
  } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — campanhas escopa organizacao_id', () => {
  it('listar filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await listarCampanhas(client, ORG)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
  })
  it('criar GRAVA organizacao_id', async () => {
    const { client, chains } = mockClient()
    await criarCampanha(client, ORG, { nome: 'Campanha X' })
    expect(chains[0].insertPayload?.organizacao_id).toBe(ORG)
  })
  it('buscar (detalhe/edição) filtra id + organizacao_id — deep-link não vaza cross-tenant', async () => {
    const { client, chains } = mockClient()
    await buscarCampanha(client, ORG, 'C1')
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('id', 'C1')).toBe(true)
    expect(chains[0].temEq('organizacao_id', OUTRA)).toBe(false)
  })
  it('atualizar (transição válida) filtra id + organizacao_id na leitura e no update', async () => {
    const { client, chains } = mockClient('rascunho')
    await atualizarCampanha(client, ORG, 'C1', { status: 'ativa' })
    for (const c of chains) {
      expect(c.temEq('organizacao_id', ORG)).toBe(true)
      expect(c.temEq('id', 'C1')).toBe(true)
    }
  })
  it('transição inválida é rejeitada (rascunho → concluida)', async () => {
    const { client } = mockClient('rascunho')
    await expect(atualizarCampanha(client, ORG, 'C1', { status: 'concluida' })).rejects.toThrow(/Transição inválida/)
  })
  it('ciclo de vida: transições permitidas', () => {
    expect(transicaoPermitida('rascunho', 'ativa')).toBe(true)
    expect(transicaoPermitida('ativa', 'pausada')).toBe(true)
    expect(transicaoPermitida('concluida', 'ativa')).toBe(false)
  })
  it('NUNCA toca organizacao_id de outro tenant', async () => {
    const { client, chains } = mockClient('ativa')
    await listarCampanhas(client, ORG)
    await criarCampanha(client, ORG, { nome: 'Y' })
    await atualizarCampanha(client, ORG, 'C1', { status: 'pausada' })
    for (const c of chains) {
      for (const [col, val] of c.eqCalls) if (col === 'organizacao_id') expect(val).toBe(ORG)
      for (const p of [c.insertPayload, c.updatePayload]) if (p && 'organizacao_id' in p) expect(p.organizacao_id).toBe(ORG)
      expect(c.temEq('organizacao_id', OUTRA)).toBe(false)
    }
  })
})
