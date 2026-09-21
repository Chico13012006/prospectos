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

  it('busca ciclo recorrente somente dentro da organização', async () => {
    const { client, chains } = mockClient()
    await store(client).buscarExecucaoParaCiclo('W1', 'L1', 'empresa:E1:2026-08')
    expect(chains.workflow_execucoes.temEq('organizacao_id', ORG)).toBe(true)
    expect(chains.workflow_execucoes.temEq('workflow_id', 'W1')).toBe(true)
    expect(chains.workflow_execucoes.temEq('lead_id', 'L1')).toBe(true)
    expect(chains.workflow_execucoes.temEq('ciclo_chave', 'empresa:E1:2026-08')).toBe(true)
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

// Retomada durável de prospecção (0047). Aqui o isolamento não está em .eq():
// as operações são RPC, então a prova é que TODA chamada leva p_org da sessão
// — nunca um id vindo do payload da fila — e que "nada casou" vira null.
function mockRpc(resposta: unknown = []) {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.push({ nome, args })
      return Promise.resolve({ data: resposta, error: null })
    },
  } as unknown as SupabaseClient
  return { client, chamadas }
}

describe('multi-tenant — RPCs de retomada de prospecção levam p_org', () => {
  it('toda operação de retomada envia p_org da organização do store', async () => {
    const { client, chamadas } = mockRpc()
    const s = store(client)
    await s.agendarEsperaProspeccao('E1', 1, 2, '2026-09-22T12:00:00.000Z', 'tok')
    await s.reivindicarRetomadaProspeccao('E1', 3, 2, 'tok')
    await s.liberarRetomadaProspeccao('E1', 'tok')
    await s.reivindicarPublicacaoProspeccao('E1', 3, 'tok', '2026-09-22T12:00:00.000Z')
    await s.confirmarPublicacaoProspeccao('E1', 3, 'tok')
    await s.liberarPublicacaoProspeccao('E1', 3, 'tok')
    await s.rearmarRetomadaProspeccao('E1', 3)
    await s.listarRetomadasProspeccao(null, 200)
    expect(chamadas).toHaveLength(8)
    expect(chamadas.every((c) => c.args.p_org === ORG)).toBe(true)
    expect(chamadas.map((c) => c.nome)).toEqual([
      'workflow_prospeccao_agendar_espera',
      'workflow_prospeccao_claim',
      'workflow_prospeccao_liberar_claim',
      'workflow_prospeccao_claim_publicacao',
      'workflow_prospeccao_confirmar_publicacao',
      'workflow_prospeccao_liberar_publicacao',
      'workflow_prospeccao_rearmar',
      'workflow_prospeccao_reconciliar_lote',
    ])
  })

  it('setof vazio vira null — e linha sem id nunca passa por sucesso', async () => {
    const vazio = store(mockRpc([]).client)
    expect(await vazio.agendarEsperaProspeccao('E1', 1, 2, 'x')).toBeNull()
    expect(await vazio.reivindicarRetomadaProspeccao('E1', 0, 0, 'tok')).toBeNull()
    expect(await vazio.rearmarRetomadaProspeccao('E1', 0)).toBeNull()
    expect(await vazio.listarRetomadasProspeccao(null, 10)).toEqual([])

    // Compatível com um retorno composto nulo (objeto de campos nulos).
    const nulo = store(mockRpc({ id: null, status: null }).client)
    expect(await nulo.agendarEsperaProspeccao('E1', 1, 2, 'x')).toBeNull()
    expect(await nulo.reivindicarRetomadaProspeccao('E1', 0, 0, 'tok')).toBeNull()

    const casou = store(mockRpc([{ id: 'E1', agendamento_geracao: 4 }]).client)
    expect(await casou.agendarEsperaProspeccao('E1', 1, 2, 'x')).toMatchObject({ id: 'E1', agendamento_geracao: 4 })
  })
})
