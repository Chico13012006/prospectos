// Isolamento multi-tenant do outbox de notificações no NÍVEL DO CÓDIGO
// (service_role bypassa RLS → toda chamada filtra/grava organizacao_id) e a
// forma do compare-and-swap de reivindicação.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseNotificacaoHandoffRepository } from '../supabaseRepository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'
const LINHA = {
  id: 'n1', organizacao_id: ORG, handoff_id: 'h1', tipo: 'grupo_comercial', status: 'pendente', tentativas: 0,
  ultimo_erro: null, dados: { empresa: 'ACME', contato: 'Ana', responsavelNome: 'Bruno', motivo: 'round_robin', etapaCadencia: 'follow-up 1' },
  destino: null, provider_message_id: null, enviado_em: null, criado_em: '2026-09-13T00:00:00Z',
}

class Chain {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  ltCalls: [string, unknown][] = []
  upsertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(public table: string, private resposta: unknown) {}
  select() { return this }
  upsert(row: Record<string, unknown>) { this.upsertPayload = row; return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  in(c: string, v: unknown[]) { this.inCalls.push([c, v]); return this }
  lt(c: string, v: unknown) { this.ltCalls.push([c, v]); return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) { resolve({ data: this.resposta, error: null }) }
}

function mockClient(resposta: unknown = LINHA) {
  const chains: Chain[] = []
  const client = { from(table: string) { const c = new Chain(table, resposta); chains.push(c); return c } } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — SupabaseNotificacaoHandoffRepository', () => {
  it('registrarIntencao grava organizacao_id, ignora duplicata (unique handoff+tipo) e relê pela org', async () => {
    const { client, chains } = mockClient()
    const repo = new SupabaseNotificacaoHandoffRepository(client)
    const n = await repo.registrarIntencao(ORG, 'h1', 'grupo_comercial', LINHA.dados as never)
    expect(chains[0].upsertPayload).toMatchObject({ organizacao_id: ORG, handoff_id: 'h1', tipo: 'grupo_comercial', status: 'pendente' })
    expect(chains[1].temEq('organizacao_id', ORG)).toBe(true)
    expect(n.id).toBe('n1')
    expect(n.dados.responsavelNome).toBe('Bruno')
  })

  it('reivindicarEnvio é um compare-and-swap: status reclamável + tentativas esperadas → enviando', async () => {
    const { client, chains } = mockClient([{ id: 'n1' }])
    const repo = new SupabaseNotificacaoHandoffRepository(client)
    expect(await repo.reivindicarEnvio(ORG, 'n1', 2)).toBe(true)
    const c = chains[0]
    expect(c.updatePayload).toMatchObject({ status: 'enviando', tentativas: 3 })
    expect(c.temEq('organizacao_id', ORG)).toBe(true)
    expect(c.temEq('id', 'n1')).toBe(true)
    expect(c.temEq('tentativas', 2)).toBe(true)
    expect(c.inCalls[0]).toEqual(['status', ['pendente', 'falhou', 'configuracao_ausente']])
    const perdeu = mockClient([])
    expect(await new SupabaseNotificacaoHandoffRepository(perdeu.client).reivindicarEnvio(ORG, 'n1', 2)).toBe(false)
  })

  it('listarReprocessaveis filtra org, status reclamáveis e tentativas abaixo do teto', async () => {
    const { client, chains } = mockClient([LINHA])
    const repo = new SupabaseNotificacaoHandoffRepository(client)
    const r = await repo.listarReprocessaveis(ORG, 5, 20)
    expect(r).toHaveLength(1)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].ltCalls).toEqual([['tentativas', 5]])
  })

  it('listarPorHandoffs (Fase 3) filtra org + tipo + handoffs; vazio sem consultar', async () => {
    const { client, chains } = mockClient([LINHA])
    const repo = new SupabaseNotificacaoHandoffRepository(client)
    expect(await repo.listarPorHandoffs(ORG, 'handoff_checkin', [])).toEqual([])
    expect(chains).toHaveLength(0)
    const r = await repo.listarPorHandoffs(ORG, 'handoff_checkin', ['h1', 'h2'])
    expect(r).toHaveLength(1)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('tipo', 'handoff_checkin')).toBe(true)
    expect(chains[0].inCalls).toEqual([['handoff_id', ['h1', 'h2']]])
  })

  it('NUNCA toca organizacao_id de outro tenant', async () => {
    // (mesma resposta para toda consulta; aqui só o escopo importa)
    const { client, chains } = mockClient([LINHA])
    const repo = new SupabaseNotificacaoHandoffRepository(client)
    await repo.buscar(ORG, 'n1')
    await repo.reivindicarEnvio(ORG, 'n1', 0)
    await repo.marcarEnviada(ORG, 'n1', { destino: 'g', providerMessageId: 'z' })
    await repo.marcarFalha(ORG, 'n1', 'erro')
    await repo.marcarConfiguracaoAusente(ORG, 'n1', 'sem grupo')
    await repo.listarReprocessaveis(ORG, 5, 10)
    await repo.listarPorHandoffs(ORG, 'handoff_checkin', ['h1'])
    for (const c of chains) {
      expect(c.temEq('organizacao_id', ORG) || c.upsertPayload?.organizacao_id === ORG).toBe(true)
      expect(c.temEq('organizacao_id', OUTRA)).toBe(false)
    }
  })
})
