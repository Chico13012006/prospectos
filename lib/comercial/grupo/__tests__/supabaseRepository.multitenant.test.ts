// Isolamento multi-tenant do SupabaseComandoGrupoRepository no NÍVEL DO CÓDIGO
// (service_role bypassa RLS → toda chamada filtra/grava organizacao_id) e a
// forma do claim (CAS) e da resolução grupo → organização.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseComandoGrupoRepository } from '../supabaseRepository'
import { SupabaseNotificacaoHandoffRepository } from '../../notificacoes/supabaseRepository'
import { SupabaseHandoffRepository } from '../../handoff/supabaseRepository'

const ORG = 'org-aaaa'
const OUTRA = 'org-bbbb'
const LINHA = {
  id: 'c1', organizacao_id: ORG, grupo_id: 'g-group', provider_message_id: 'MSG-1', remetente: '5511', remetente_nome: 'X',
  texto: '#ABCDEF 2', codigo_ref: 'ABCDEF', comando: '2', handoff_id: null, notificacao_id: null, status: 'recebido',
  resultado: null, erro: null, recebido_em: '2026-09-13T00:00:00Z', processado_em: null, atualizado_em: '2026-09-13T00:00:00Z',
}

class Chain {
  eqCalls: [string, unknown][] = []
  orCalls: string[] = []
  isCalls: [string, unknown][] = []
  upsertPayload: Record<string, unknown> | null = null
  updatePayload: Record<string, unknown> | null = null
  constructor(public table: string, private resposta: unknown) {}
  select() { return this }
  upsert(row: Record<string, unknown>) { this.upsertPayload = row; return this }
  update(row: Record<string, unknown>) { this.updatePayload = row; return this }
  eq(c: string, v: unknown) { this.eqCalls.push([c, v]); return this }
  neq() { return this }
  or(f: string) { this.orCalls.push(f); return this }
  is(c: string, v: unknown) { this.isCalls.push([c, v]); return this }
  order() { return this }
  limit() { return this }
  maybeSingle() { return this }
  temEq(col: string, val: unknown) { return this.eqCalls.some(([c, v]) => c === col && v === val) }
  then(resolve: (v: unknown) => void) { resolve({ data: this.resposta, error: null }) }
}

function mockClient(respostas: Record<string, unknown> = {}) {
  const chains: Chain[] = []
  const client = { from(table: string) { const c = new Chain(table, respostas[table] ?? null); chains.push(c); return c } } as unknown as SupabaseClient
  return { client, chains }
}

describe('multi-tenant — SupabaseComandoGrupoRepository', () => {
  it('resolverOrganizacoesDoGrupo consulta o grupo configurado no blob (JSON path) e devolve TODAS as orgs que casam', async () => {
    const { client, chains } = mockClient({ organizacoes: [{ id: ORG }, { id: OUTRA }] })
    const repo = new SupabaseComandoGrupoRepository(client)
    expect(await repo.resolverOrganizacoesDoGrupo('g-group')).toEqual([ORG, OUTRA])
    expect(chains[0].table).toBe('organizacoes')
    expect(chains[0].temEq('configuracoes->comercial->>grupoWhatsappId', 'g-group')).toBe(true)
  })

  it('registrar grava organizacao_id e usa unique org+messageId (duplicata → relê a existente)', async () => {
    const { client, chains } = mockClient({ comercial_grupo_comandos: [LINHA] })
    const repo = new SupabaseComandoGrupoRepository(client)
    const r = await repo.registrar(ORG, { grupoId: 'g-group', providerMessageId: 'MSG-1', remetente: '5511', remetenteNome: 'X', texto: '#ABCDEF 2', codigoRef: 'ABCDEF', comando: '2', recebidoEm: '2026-09-13T00:00:00Z' })
    expect(chains[0].upsertPayload).toMatchObject({ organizacao_id: ORG, provider_message_id: 'MSG-1', comando: '2', codigo_ref: 'ABCDEF' })
    expect(r.novo).toBe(true)
    expect(r.comando.organizacaoId).toBe(ORG)
    // upsert ignorado devolve vazio → relê pela org + messageId (fake devolve null nas duas)
    const dup = mockClient({ comercial_grupo_comandos: null })
    const repo2 = new SupabaseComandoGrupoRepository(dup.client)
    await expect(repo2.registrar(ORG, { grupoId: 'g', providerMessageId: 'MSG-1', remetente: null, remetenteNome: null, texto: 't', codigoRef: null, comando: null, recebidoEm: 'x' })).rejects.toThrow(/não encontrado/)
    expect(dup.chains[1].temEq('organizacao_id', ORG)).toBe(true)
    expect(dup.chains[1].temEq('provider_message_id', 'MSG-1')).toBe(true)
  })

  it('reivindicar é um compare-and-swap por status (recebido|falhou, ou processando preso) na org', async () => {
    const { client, chains } = mockClient({ comercial_grupo_comandos: [{ id: 'c1' }] })
    const repo = new SupabaseComandoGrupoRepository(client)
    expect(await repo.reivindicar(ORG, 'c1', '2026-09-13T11:55:00.000Z')).toBe(true)
    expect(chains[0].updatePayload).toEqual({ status: 'processando' })
    expect(chains[0].temEq('organizacao_id', ORG)).toBe(true)
    expect(chains[0].orCalls[0]).toContain('status.in.(recebido,falhou)')
    expect(chains[0].orCalls[0]).toContain('atualizado_em.lt.2026-09-13T11:55:00.000Z')
    const perdeu = mockClient({ comercial_grupo_comandos: [] })
    expect(await new SupabaseComandoGrupoRepository(perdeu.client).reivindicar(ORG, 'c1', 'x')).toBe(false)
  })

  it('NUNCA toca organizacao_id de outro tenant (comandos, notificação por código, encerrar handoff)', async () => {
    const { client, chains } = mockClient({ comercial_grupo_comandos: [LINHA], comercial_handoff_notificacoes: null, comercial_handoffs: [{ id: 'h1' }] })
    const repo = new SupabaseComandoGrupoRepository(client)
    await repo.registrar(ORG, { grupoId: 'g', providerMessageId: 'M', remetente: null, remetenteNome: null, texto: 't', codigoRef: null, comando: null, recebidoEm: 'x' })
    await repo.reivindicar(ORG, 'c1', 'x')
    await repo.concluir(ORG, 'c1', { status: 'concluido', resultado: 'continuar', handoffId: 'h1' })
    await repo.falhar(ORG, 'c1', 'erro', 'e')
    await repo.listarReprocessaveis(ORG, 'x', 10)
    await new SupabaseNotificacaoHandoffRepository(client).buscarPorCodigo(ORG, 'ABCDEF')
    const h = new SupabaseHandoffRepository(client)
    await h.buscarHandoff(ORG, 'h1')
    await h.encerrar(ORG, 'h1', 'retorno_followup')
    for (const c of chains) {
      if (c.table === 'organizacoes') continue
      expect(c.temEq('organizacao_id', ORG) || c.upsertPayload?.organizacao_id === ORG).toBe(true)
      expect(c.temEq('organizacao_id', OUTRA)).toBe(false)
    }
    const enc = chains.find((c) => c.table === 'comercial_handoffs' && c.updatePayload)!
    expect(enc.updatePayload).toMatchObject({ encerrado_motivo: 'retorno_followup' })
    expect(enc.isCalls).toEqual([['encerrado_em', null]]) // só fecha o que está aberto
  })
})
