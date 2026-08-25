// Isolamento multi-tenant das tabelas NOVAS e sensíveis da renovação —
// servicos_recorrentes, tarefas, notificacoes — no NÍVEL DO CÓDIGO.
//
// Como o processador usa service_role (que BYPASSA a RLS do Postgres), o
// isolamento neste caminho depende de o código SEMPRE escopar organizacao_id:
// filtrar em toda leitura e carimbar em toda escrita. Estes testes provam isso
// com um client Supabase falso que registra os .eq() e os payloads de insert.
//
// A garantia central ("tenant A nunca lê nem escreve dado de tenant B") aqui é:
//   nenhuma chamada pode tocar organizacao_id != org do processador.
// (A prova de RLS de verdade, com 2 orgs num Postgres real, é o E2E à parte —
// service_role não passa por RLS; ver lib/engine/__tests__/multitenant.test.ts.)
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processarRenovacoes } from '../processar'

const ORG = 'org-aaaa'

// Chain falso encadeável e "thenable". Registra eq() e insert payload; o modo
// (select/count/insert) decide o resultado devolvido para cada tabela.
class Chain {
  eqCalls: [string, unknown][] = []
  insertPayload: Record<string, unknown> | null = null
  mode: 'select' | 'count' | 'insert' = 'select'
  constructor(public table: string, private scenario: 'servico' | 'legado') {}
  select(_cols?: unknown, opts?: { head?: boolean }) {
    if (opts?.head) this.mode = 'count'
    return this
  }
  insert(row: Record<string, unknown>) { this.mode = 'insert'; this.insertPayload = row; return this }
  update(row: Record<string, unknown>) { this.insertPayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in() { return this }
  not() { return this }
  lte() { return this }
  gte() { return this }
  is() { return this }
  ilike() { return this }
  or() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  single() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  private resultado(): { data?: unknown; error: null; count?: number } {
    if (this.table === 'organizacoes') return { data: { configuracoes: {} }, error: null }
    if (this.table === 'servicos_recorrentes') {
      if (this.scenario === 'legado') return { data: [], error: null }
      return { data: [{ id: 'S1', empresa_id: 'E1', vencimento_em: '2026-08-20', responsavel_id: null }], error: null }
    }
    if (this.table === 'empresas') return { data: { nome: 'Empresa A' }, error: null }
    if (this.table === 'leads') {
      if (this.scenario === 'legado') return { data: [{
        id: 'L1', empresa_id: null, empresa: 'Empresa legada', data_validade: '2026-08-20',
        responsavel_id: null, contato_email: 'contato@empresa.test',
      }], error: null }
      return { data: [], error: null }
    }
    if (this.table === 'tarefas') {
      if (this.mode === 'insert') return { data: { id: 'T1' }, error: null }
      return { data: [], error: null } // dedup: nenhuma tarefa aberta ainda
    }
    return { data: null, error: null } // notificacoes insert
  }
  then(resolve: (v: unknown) => void) { resolve(this.resultado()) }
}

function mockClient(scenario: 'servico' | 'legado' = 'servico') {
  const chains: Chain[] = []
  const client = {
    from(table: string) { const c = new Chain(table, scenario); chains.push(c); return c },
  } as unknown as SupabaseClient
  return { client, chains }
}

const doTabela = (chains: Chain[], t: string) => chains.filter((c) => c.table === t)

describe('multi-tenant — processarRenovacoes escopa organizacao_id nas tabelas novas', () => {
  it('lê serviços SÓ da org (filtra organizacao_id na contagem e na janela)', async () => {
    const { client, chains } = mockClient()
    await processarRenovacoes(ORG, { client, hoje: new Date('2026-08-10') })
    const svc = doTabela(chains, 'servicos_recorrentes')
    expect(svc.length).toBeGreaterThan(0)
    for (const c of svc) expect(c.temEq('organizacao_id', ORG)).toBe(true)
  })

  it('dedup de tarefa é filtrado por organizacao_id', async () => {
    const { client, chains } = mockClient()
    await processarRenovacoes(ORG, { client, hoje: new Date('2026-08-10') })
    const dedup = doTabela(chains, 'tarefas').filter((c) => c.mode === 'select')
    expect(dedup.length).toBeGreaterThan(0)
    for (const c of dedup) {
      expect(c.temEq('organizacao_id', ORG)).toBe(true)
      expect(c.temEq('prazo_em', '2026-08-20T00:00:00.000Z')).toBe(true)
    }
  })

  it('GRAVA organizacao_id ao criar tarefa e notificação', async () => {
    const { client, chains } = mockClient()
    await processarRenovacoes(ORG, { client, hoje: new Date('2026-08-10') })
    const tarefaInsert = doTabela(chains, 'tarefas').find((c) => c.mode === 'insert')
    const notifInsert = doTabela(chains, 'notificacoes').find((c) => c.insertPayload)
    expect(tarefaInsert?.insertPayload?.organizacao_id).toBe(ORG)
    expect(notifInsert?.insertPayload?.organizacao_id).toBe(ORG)
  })

  // A trava mais forte: em NENHUMA chamada (leitura ou escrita) o processador
  // pode tocar em organizacao_id diferente do seu. Se um dia alguém esquecer o
  // .eq('organizacao_id', org) ou carimbar outra org, este teste quebra.
  it('NUNCA toca organizacao_id de outro tenant (nem lendo, nem escrevendo)', async () => {
    const { client, chains } = mockClient()
    await processarRenovacoes(ORG, { client, hoje: new Date('2026-08-10') })
    for (const c of chains) {
      for (const [col, val] of c.eqCalls) {
        if (col === 'organizacao_id') expect(val).toBe(ORG)
      }
      if (c.insertPayload && 'organizacao_id' in c.insertPayload) {
        expect(c.insertPayload.organizacao_id).toBe(ORG)
      }
    }
  })

  it('usa data_validade como fallback e cria tarefa idempotente sem servico_id', async () => {
    const { client, chains } = mockClient('legado')
    const r = await processarRenovacoes(ORG, { client, hoje: new Date('2026-08-10') })

    expect(r.avaliados).toBe(1)
    expect(r.itens[0]).toMatchObject({ fonte: 'lead_legado', empresa: 'Empresa legada', vencimento: '2026-08-20' })
    const dedup = doTabela(chains, 'tarefas').find((c) => c.mode === 'select')
    expect(dedup?.temEq('organizacao_id', ORG)).toBe(true)
    expect(dedup?.temEq('lead_id', 'L1')).toBe(true)
    expect(dedup?.temEq('prazo_em', '2026-08-20T00:00:00.000Z')).toBe(true)
    const tarefa = doTabela(chains, 'tarefas').find((c) => c.mode === 'insert')
    expect(tarefa?.insertPayload).toMatchObject({
      organizacao_id: ORG,
      lead_id: 'L1',
      servico_id: null,
      prazo_em: '2026-08-20T00:00:00.000Z',
    })
  })
})
