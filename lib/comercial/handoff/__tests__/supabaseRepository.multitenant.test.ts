// Isolamento multi-tenant do SupabaseHandoffRepository no NÍVEL DO CÓDIGO.
//
// O repository usa service_role (BYPASSA a RLS), então o isolamento depende de
// SEMPRE escopar organizacao_id: filtrar em toda leitura, gravar em toda escrita
// e passar p_organizacao_id à RPC. Provado com um client falso que registra os
// .eq()/.upsert()/.rpc() (mesmo padrão de lib/oportunidades). A prova de RLS e
// da função no Postgres real é o E2E à parte (scripts/test-handoff-e2e.mjs).
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseHandoffRepository, mapearRegistroHandoff } from '../supabaseRepository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'

const LINHA = {
  id: 'h1', organizacao_id: ORG, lead_id: 'L1', evento_id: 'ev-1', origem: 'prospeccao',
  responsavel_id: 'u1', motivo: 'round_robin', primeira_atribuicao: true,
  status: 'em_contato_comercial', atribuido_em: '2026-09-13T00:00:00Z', encerrado_em: null,
  criado_em: '2026-09-13T00:00:00Z',
} as const

class Chain {
  eqCalls: [string, unknown][] = []
  upsertPayload: Record<string, unknown> | null = null
  constructor(public table: string, private resposta: unknown) {}
  select() { return this }
  upsert(row: Record<string, unknown>) { this.upsertPayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  lteCalls: [string, unknown][] = []
  lte(c: string, v: unknown) { this.lteCalls.push([c, v]); return this }
  is() { return this }
  not() { return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) { resolve({ data: this.resposta, error: null }) }
}

function mockClient(respostas: Record<string, unknown> = {}, rpcResposta: unknown = { resultado: 'confirmado', handoff: LINHA }) {
  const chains: Chain[] = []
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    from(table: string) { const c = new Chain(table, respostas[table] ?? null); chains.push(c); return c },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: rpcResposta, error: null })
    },
  } as unknown as SupabaseClient
  return { client, chains, rpcCalls }
}

const entrada = { organizacaoId: ORG, leadId: 'L1', eventoId: 'ev-1', origem: 'prospeccao' as const }
const decisaoRR = { responsavelId: 'u1', motivo: 'round_robin' as const, primeiraAtribuicao: true, cursorVersaoEsperada: 3 }

describe('multi-tenant — SupabaseHandoffRepository escopa organizacao_id', () => {
  it('buscarLead filtra por organizacao_id E id', async () => {
    const { client, chains } = mockClient({ leads: { id: 'L1', responsavel_id: null, empresa: 'ACME', contato_nome: null } })
    const repo = new SupabaseHandoffRepository(client)
    const lead = await repo.buscarLead(ORG, 'L1')
    expect(lead).toEqual({ id: 'L1', responsavelId: null, empresa: 'ACME', contatoNome: '' })
    expect(chains[0].table).toBe('leads')
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('id', 'L1')).toBe(true)
  })

  it('buscarHandoffAberto e buscarHistorico filtram por organizacao_id (inclusive a checagem do usuário)', async () => {
    const { client, chains } = mockClient({
      comercial_handoffs: [{ responsavel_id: 'u1' }],
      usuarios: { id: 'u1', nome: 'Bruno' },
    })
    const repo = new SupabaseHandoffRepository(client)
    await repo.buscarHandoffAberto(ORG, 'L1')
    const hist = await repo.buscarHistorico(ORG, 'L1')
    expect(hist).toEqual({ jaTeveAtribuicao: true, responsavelPreservavel: { usuarioId: 'u1', nome: 'Bruno' } })
    for (const c of chains) expect(c.temEq('organizacao_id', ORG)).toBe(true)
    const usuarios = chains.find((c) => c.table === 'usuarios')!
    expect(usuarios.temEq('ativo', true)).toBe(true)
  })

  it('listarDistribuicao lê usuarios ATIVOS e participantes só da org; ausente = não participa', async () => {
    const { client, chains } = mockClient({
      usuarios: [{ id: 'u1', nome: 'Bruno', email: 'b@x' }, { id: 'u2', nome: 'Silmara', email: null }],
      comercial_distribuicao_participantes: [{ usuario_id: 'u1', participa: true }],
    })
    const repo = new SupabaseHandoffRepository(client)
    const lista = await repo.listarDistribuicao(ORG)
    expect(lista).toEqual([
      { usuarioId: 'u1', nome: 'Bruno', email: 'b@x', participa: true },
      { usuarioId: 'u2', nome: 'Silmara', email: null, participa: false },
    ])
    for (const c of chains) expect(c.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.find((c) => c.table === 'usuarios')!.temEq('ativo', true)).toBe(true)
  })

  it('lerCursor filtra por org e, sem linha, devolve cursor zerado', async () => {
    const { client, chains } = mockClient()
    const repo = new SupabaseHandoffRepository(client)
    expect(await repo.lerCursor(ORG)).toEqual({ ultimoUsuarioId: null, versao: 0 })
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
  })

  it('confirmar chama a RPC com p_organizacao_id da org e a decisão inteira', async () => {
    const { client, rpcCalls } = mockClient()
    const repo = new SupabaseHandoffRepository(client)
    const r = await repo.confirmar(entrada, decisaoRR)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('comercial_handoff_confirmar')
    expect(rpcCalls[0].args).toEqual({
      p_organizacao_id: ORG, p_lead_id: 'L1', p_evento_id: 'ev-1', p_origem: 'prospeccao',
      p_responsavel_id: 'u1', p_motivo: 'round_robin', p_primeira_atribuicao: true, p_cursor_versao_esperada: 3,
    })
    expect(r).toEqual({ resultado: 'confirmado', handoff: mapearRegistroHandoff(LINHA) })
  })

  it('confirmar mapeia os resultados controlados sem handoff e rejeita resultado desconhecido', async () => {
    for (const resultado of ['lead_nao_encontrado', 'participante_inelegivel', 'conflito_cursor']) {
      const { client } = mockClient({}, { resultado })
      expect(await new SupabaseHandoffRepository(client).confirmar(entrada, decisaoRR)).toEqual({ resultado })
    }
    const { client } = mockClient({}, { resultado: 'xyz' })
    await expect(new SupabaseHandoffRepository(client).confirmar(entrada, decisaoRR)).rejects.toThrow(/desconhecido/)
  })

  it('definirParticipacao valida o usuário NA org e grava organizacao_id no upsert', async () => {
    const { client, chains } = mockClient({ usuarios: { id: 'u1' } })
    const repo = new SupabaseHandoffRepository(client)
    expect(await repo.definirParticipacao(ORG, 'u1', false)).toBe('ok')
    const usuarios = chains.find((c) => c.table === 'usuarios')!
    expect(usuarios.temEq('organizacao_id', ORG)).toBe(true)
    expect(usuarios.temEq('id', 'u1')).toBe(true)
    const upsert = chains.find((c) => c.table === 'comercial_distribuicao_participantes')!
    expect(upsert.upsertPayload).toEqual({ organizacao_id: ORG, usuario_id: 'u1', participa: false })
  })

  it('definirParticipacao com usuário de outra org (não encontrado na org) → não grava nada', async () => {
    const { client, chains } = mockClient({ usuarios: null })
    const repo = new SupabaseHandoffRepository(client)
    expect(await repo.definirParticipacao(ORG, 'u-da-outra', true)).toBe('usuario_nao_encontrado')
    expect(chains.some((c) => c.table === 'comercial_distribuicao_participantes')).toBe(false)
  })

  it('listarAbertos (Fase 3) filtra org e status aberto', async () => {
    const { client, chains } = mockClient({ comercial_handoffs: [LINHA] })
    const repo = new SupabaseHandoffRepository(client)
    const r = await repo.listarAbertos(ORG, 50)
    expect(r).toHaveLength(1)
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].temEq('status', 'em_contato_comercial')).toBe(true)
  })

  // Trava mais forte: nenhuma chamada pode tocar organizacao_id de OUTRO tenant.
  it('NUNCA toca organizacao_id de outro tenant', async () => {
    // (o fake devolve a mesma resposta para toda consulta à tabela; aqui só o
    // escopo importa, não o formato)
    const { client, chains, rpcCalls } = mockClient({ usuarios: [{ id: 'u1', nome: 'B' }], comercial_handoffs: [] })
    const repo = new SupabaseHandoffRepository(client)
    await repo.buscarLead(ORG, 'L1')
    await repo.buscarHandoffAberto(ORG, 'L1')
    await repo.buscarHistorico(ORG, 'L1')
    await repo.listarDistribuicao(ORG)
    await repo.lerCursor(ORG)
    await repo.confirmar(entrada, decisaoRR)
    await repo.definirParticipacao(ORG, 'u1', true)
    await repo.listarAbertos(ORG, 10)
    for (const c of chains) {
      // Toda leitura filtra a org; a única escrita direta (upsert) carrega a org.
      expect(c.temEq('organizacao_id', ORG) || c.upsertPayload?.organizacao_id === ORG).toBe(true)
      for (const [col, val] of c.eqCalls) if (col === 'organizacao_id') expect(val).toBe(ORG)
      if (c.upsertPayload) expect(c.upsertPayload.organizacao_id).toBe(ORG)
      expect(c.temEq('organizacao_id', OUTRA)).toBe(false)
    }
    for (const r of rpcCalls) expect(r.args.p_organizacao_id).toBe(ORG)
  })
})
