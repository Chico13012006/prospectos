import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarControleExecucaoCampanha } from '../controleExecucaoServidor'

class Chain {
  eqCalls: [string, unknown][] = []
  select() { return this }
  eq(campo: string, valor: unknown) { this.eqCalls.push([campo, valor]); return this }
  maybeSingle() {
    return Promise.resolve({
      data: { status: 'ativa', publico: { agenda: { diasSemana: ['dom'] } } },
      error: null,
    })
  }
}

describe('controle de execução da campanha', () => {
  it('lê status e agenda com organização e id explícitos', async () => {
    const chain = new Chain()
    const client = { from: () => chain } as unknown as SupabaseClient
    const controle = await buscarControleExecucaoCampanha(client, 'org-1', 'campanha-1')

    expect(chain.eqCalls).toEqual([
      ['organizacao_id', 'org-1'],
      ['id', 'campanha-1'],
    ])
    expect(controle).toEqual({ status: 'ativa', diasSemana: ['dom'], disparoUnico: false })
  })

  it('reconhece comunicação legada como disparo único pelo tipo', async () => {
    const chain = new Chain()
    chain.maybeSingle = () => Promise.resolve({
      data: { status: 'ativa', tipo: 'novidade_clientes', publico: { agenda: { diasSemana: ['seg'] } } },
      error: null,
    })
    const client = { from: () => chain } as unknown as SupabaseClient

    await expect(buscarControleExecucaoCampanha(client, 'org-1', 'campanha-1')).resolves.toMatchObject({
      disparoUnico: true,
    })
  })
})
