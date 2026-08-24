import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { concluirDisparoUnicoSeFinalizado } from '../conclusaoDisparoServidor'

class Consulta {
  eqCalls: [string, unknown][] = []
  inCalls: [string, unknown[]][] = []
  patch: Record<string, unknown> | null = null

  constructor(
    private readonly resultado: { data?: unknown; count?: number | null; error?: unknown },
  ) {}

  select() { return this }
  update(patch: Record<string, unknown>) { this.patch = patch; return this }
  eq(campo: string, valor: unknown) { this.eqCalls.push([campo, valor]); return this }
  in(campo: string, valores: unknown[]) {
    this.inCalls.push([campo, valores])
    return Promise.resolve(this.resultado)
  }
  maybeSingle() { return Promise.resolve(this.resultado) }
}

describe('conclusão de disparo único', () => {
  it('conclui somente a comunicação da organização quando não há execução ativa', async () => {
    const campanha = new Consulta({
      data: { status: 'ativa', tipo: 'novidade_clientes', publico: { operacao: { modoEnvio: 'disparo_unico' } } },
      error: null,
    })
    const execucoes = new Consulta({ count: 0, error: null })
    const atualizacao = new Consulta({ error: null })
    let chamadasCampanha = 0
    const client = {
      from(tabela: string) {
        if (tabela === 'workflow_execucoes') return execucoes
        chamadasCampanha += 1
        return chamadasCampanha === 1 ? campanha : atualizacao
      },
    } as unknown as SupabaseClient

    await expect(concluirDisparoUnicoSeFinalizado(client, 'org-1', 'campanha-1')).resolves.toBe(true)
    expect(campanha.eqCalls).toEqual([
      ['organizacao_id', 'org-1'],
      ['id', 'campanha-1'],
    ])
    expect(execucoes.eqCalls).toEqual([
      ['organizacao_id', 'org-1'],
      ['campanha_id', 'campanha-1'],
    ])
    expect(execucoes.inCalls).toEqual([
      ['status', ['em_andamento', 'aguardando']],
    ])
    expect(atualizacao.patch).toMatchObject({ status: 'concluida' })
    expect(atualizacao.eqCalls).toEqual([
      ['organizacao_id', 'org-1'],
      ['id', 'campanha-1'],
      ['status', 'ativa'],
    ])
  })

  it('mantém ativa enquanto houver execução pendente', async () => {
    const campanha = new Consulta({
      data: { status: 'ativa', tipo: 'renovacao', publico: {} },
      error: null,
    })
    const execucoes = new Consulta({ count: 1, error: null })
    const client = {
      from(tabela: string) { return tabela === 'campanhas' ? campanha : execucoes },
    } as unknown as SupabaseClient

    await expect(concluirDisparoUnicoSeFinalizado(client, 'org-1', 'campanha-1')).resolves.toBe(false)
    expect(campanha.patch).toBeNull()
  })
})
