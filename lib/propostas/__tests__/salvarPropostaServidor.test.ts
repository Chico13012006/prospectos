// Isolamento multi-tenant de salvarProposta no NÍVEL DO CÓDIGO: o client é
// service_role (bypassa RLS), então a organização precisa vir da sessão e ser
// filtrada/gravada explicitamente. Client falso registra cada consulta.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { salvarProposta } from '../salvarPropostaServidor'

const ORG = 'org-A'
const OUTRA = 'org-B'
const LEAD = { id: 'L1', empresa: 'iNOVACODE', contato_nome: 'Guilherme', contato_email: 'g@acme.com', contato_telefone: null }

const DADOS = {
  leadId: 'L1',
  modelo: 'comodato',
  itens: [{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }],
  valorFinal: 0,
  mensalFinal: 590,
  entradaFinal: 3000,
}

interface Consulta { tabela: string; op: 'select' | 'insert'; payload?: Record<string, unknown>; eqs: Array<[string, unknown]> }

function dbFake(lead: unknown) {
  const consultas: Consulta[] = []
  const client = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: 'select', eqs: [] }
      consultas.push(c)
      const q = {
        select: () => q,
        insert: (p: Record<string, unknown>) => { c.op = 'insert'; c.payload = p; return q },
        eq: (col: string, v: unknown) => { c.eqs.push([col, v]); return q },
        maybeSingle: () => q,
        single: () => q,
        then: (resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) => {
          const data = tabela === 'leads' ? lead : { id: 'P1', ...c.payload }
          return Promise.resolve({ data, error: null }).then(resolver, rejeitar)
        },
      }
      return q
    },
  } as unknown as SupabaseClient
  return { client, consultas }
}

const entrada = (dados: unknown) => ({ dados, organizacaoId: ORG, usuarioId: 'U1', usuarioNome: 'Chico' })

describe('salvarProposta', () => {
  it('grava com a organização da SESSÃO e valores recalculados, mesmo com corpo adulterado', async () => {
    const db = dbFake(LEAD)
    const r = await salvarProposta(db.client, entrada({ ...DADOS, organizacao_id: OUTRA, mensalTabela: 1, total: 1 }))
    expect(r.ok).toBe(true)

    const leitura = db.consultas.find((c) => c.tabela === 'leads')!
    expect(leitura.eqs).toEqual(expect.arrayContaining([['id', 'L1'], ['organizacao_id', ORG]]))

    const insert = db.consultas.find((c) => c.op === 'insert')!
    expect(insert.tabela).toBe('propostas_comerciais')
    expect(insert.payload).toMatchObject({
      organizacao_id: ORG, lead_id: 'L1', modelo: 'comodato',
      mensal_final: 590, entrada_final: 3000, prazo_meses: 24,
      mensal_tabela: 1180, entrada_tabela: 3000, total: 17160,
      status: 'salva', criado_por: 'U1', criado_por_nome: 'Chico',
    })
    if (r.ok) expect(r.proposta.leads).toEqual(LEAD)
  })

  it('lead de outra organização (não encontrado na org) → não grava nada', async () => {
    const db = dbFake(null)
    const r = await salvarProposta(db.client, entrada(DADOS))
    expect(r).toMatchObject({ ok: false, codigo: 'lead_nao_encontrado' })
    expect(db.consultas.some((c) => c.op === 'insert')).toBe(false)
  })

  it('proposta inválida → erro sem tocar no banco', async () => {
    const db = dbFake(LEAD)
    const r = await salvarProposta(db.client, entrada({ ...DADOS, itens: [] }))
    expect(r).toMatchObject({ ok: false, codigo: 'invalida' })
    expect(db.consultas).toHaveLength(0)
  })

  it('NUNCA toca organizacao_id de outro tenant', async () => {
    const db = dbFake(LEAD)
    await salvarProposta(db.client, entrada({ ...DADOS, organizacao_id: OUTRA }))
    for (const c of db.consultas) {
      for (const [col, val] of c.eqs) if (col === 'organizacao_id') expect(val).toBe(ORG)
      if (c.payload) expect(c.payload.organizacao_id).toBe(ORG)
      expect(JSON.stringify(c)).not.toContain(OUTRA)
    }
  })
})
