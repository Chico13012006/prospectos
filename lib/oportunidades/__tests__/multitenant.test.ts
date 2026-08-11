// Isolamento multi-tenant de `oportunidades` no NÍVEL DO CÓDIGO.
//
// O repository usa service_role (BYPASSA a RLS do Postgres), então o isolamento
// depende de SEMPRE escopar organizacao_id: filtrar em toda leitura/update e
// carimbar em toda escrita. Estes testes provam isso com um client Supabase
// falso que registra os .eq() e o payload de insert/update. (A prova de RLS de
// verdade, com 2 orgs num Postgres real, é o E2E à parte — service_role não
// passa por RLS.)
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listarOportunidades, criarOportunidade, atualizarOportunidade } from '../repository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'

class Chain {
  eqCalls: [string, unknown][] = []
  insertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(public table: string) {}
  select() { return this }
  insert(row: Record<string, unknown>) { this.insertPayload = row; return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  order() { return this }
  limit() { return this }
  single() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) {
    resolve({ data: this.insertPayload ? { id: 'O1' } : [], error: null })
  }
}

function mockClient() {
  const chains: Chain[] = []
  const client = {
    from(table: string) { const c = new Chain(table); chains.push(c); return c },
  } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — oportunidades escopa organizacao_id', () => {
  it('listar filtra por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await listarOportunidades(client, ORG)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
  })

  it('listar por status mantém o filtro de org', async () => {
    const { client, chains } = mockClient()
    await listarOportunidades(client, ORG, { status: 'ganha' })
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('status', 'ganha')).toBe(true)
  })

  it('criar GRAVA organizacao_id da org (nunca de outra)', async () => {
    const { client, chains } = mockClient()
    await criarOportunidade(client, ORG, { titulo: 'Deal', valor: 1000 })
    expect(chains[0].insertPayload?.organizacao_id).toBe(ORG)
  })

  it('atualizar filtra por id E organizacao_id', async () => {
    const { client, chains } = mockClient()
    await atualizarOportunidade(client, ORG, 'O1', { status: 'ganha' })
    expect(chains[0].temEq('id', 'O1')).toBe(true)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
  })

  // Trava mais forte: nenhuma chamada pode tocar organizacao_id de OUTRO tenant.
  it('NUNCA toca organizacao_id de outro tenant', async () => {
    const { client, chains } = mockClient()
    await listarOportunidades(client, ORG)
    await criarOportunidade(client, ORG, { titulo: 'X' })
    await atualizarOportunidade(client, ORG, 'O1', { titulo: 'Y' })
    for (const c of chains) {
      for (const [col, val] of c.eqCalls) if (col === 'organizacao_id') expect(val).toBe(ORG)
      for (const p of [c.insertPayload, c.updatePayload]) {
        if (p && 'organizacao_id' in p) expect(p.organizacao_id).toBe(ORG)
      }
      expect(c.temEq('organizacao_id', OUTRA)).toBe(false)
    }
  })
})
