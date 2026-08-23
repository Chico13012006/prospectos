import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { atualizarDadosCadastraisLead, buscarLeadParaEdicao, emailPertenceAOutroLead } from '../repository'

const ORG = 'org-a'

class Chain {
  eqCalls: Array<[string, unknown]> = []
  ilikeCalls: Array<[string, unknown]> = []
  neqCalls: Array<[string, unknown]> = []
  updatePayload: Record<string, unknown> | null = null
  select() { return this }
  update(patch: Record<string, unknown>) { this.updatePayload = patch; return this }
  eq(campo: string, valor: unknown) { this.eqCalls.push([campo, valor]); return this }
  ilike(campo: string, valor: unknown) { this.ilikeCalls.push([campo, valor]); return this }
  neq(campo: string, valor: unknown) { this.neqCalls.push([campo, valor]); return this }
  limit() { return this }
  maybeSingle() { return Promise.resolve({ data: this.updatePayload ? { id: 'lead-1', ...this.updatePayload } : null, error: null }) }
}

function mockClient() {
  const chains: Chain[] = []
  const client = { from() { const chain = new Chain(); chains.push(chain); return chain } } as unknown as SupabaseClient
  return { client, chains }
}

describe('edição de leads — isolamento multi-tenant', () => {
  it('busca o lead por id e organização', async () => {
    const { client, chains } = mockClient()
    await buscarLeadParaEdicao(client, ORG, 'lead-1')
    expect(chains[0].eqCalls).toContainEqual(['id', 'lead-1'])
    expect(chains[0].eqCalls).toContainEqual(['organizacao_id', ORG])
  })

  it('verifica duplicidade apenas dentro da organização e exclui o próprio lead', async () => {
    const { client, chains } = mockClient()
    await emailPertenceAOutroLead(client, ORG, 'lead-1', 'a@empresa.com')
    expect(chains[0].eqCalls).toContainEqual(['organizacao_id', ORG])
    expect(chains[0].ilikeCalls).toContainEqual(['contato_email', 'a@empresa.com'])
    expect(chains[0].neqCalls).toContainEqual(['id', 'lead-1'])
  })

  it('atualiza por id e organização sem aceitar organizacao_id no patch', async () => {
    const { client, chains } = mockClient()
    await atualizarDadosCadastraisLead(client, ORG, 'lead-1', { empresa: 'Nova empresa' })
    expect(chains[0].updatePayload).toEqual({ empresa: 'Nova empresa' })
    expect(chains[0].eqCalls).toContainEqual(['id', 'lead-1'])
    expect(chains[0].eqCalls).toContainEqual(['organizacao_id', ORG])
  })
})
