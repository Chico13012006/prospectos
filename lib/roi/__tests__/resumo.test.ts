import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calcularResumo, resumoRoi } from '../resumo'

describe('roi — calcularResumo (puro)', () => {
  const rows = [
    { valor: 1000, status: 'ganha' },
    { valor: 3000, status: 'ganha' },
    { valor: 500, status: 'perdida' },
    { valor: 2000, status: 'aberta' },
    { valor: null, status: 'aberta' },
  ]
  it('soma por status, conversão e ticket médio', () => {
    const r = calcularResumo(rows)
    expect(r.ganho).toBe(4000)
    expect(r.perdido).toBe(500)
    expect(r.pipeline).toBe(2000)
    expect(r.ganhas).toBe(2)
    expect(r.taxaConversao).toBeCloseTo(2 / 3)
    expect(r.ticketMedio).toBe(2000)
    expect(r.roiPercent).toBeNull()
  })
  it('roiPercent usa o custo quando informado', () => {
    const r = calcularResumo(rows, 2000)
    expect(r.custoMensal).toBe(2000)
    expect(r.roiPercent).toBeCloseTo((4000 - 2000) / 2000) // 1.0 = +100%
  })
  it('sem fechadas: conversão e ticket = 0, sem divisão por zero', () => {
    const r = calcularResumo([{ valor: 100, status: 'aberta' }])
    expect(r.taxaConversao).toBe(0)
    expect(r.ticketMedio).toBe(0)
  })
})

describe('roi — resumoRoi é org-scoped', () => {
  it('filtra oportunidades por organizacao_id', async () => {
    const eqCalls: [string, unknown][] = []
    const client = {
      from() {
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => { eqCalls.push([c, v]); return chain },
          then: (res: (v: unknown) => void) => res({ data: [], error: null }),
        }
        return chain
      },
    } as unknown as SupabaseClient
    await resumoRoi(client, 'org-aaaa')
    expect(eqCalls).toContainEqual(['organizacao_id', 'org-aaaa'])
    expect(eqCalls.some(([c, v]) => c === 'organizacao_id' && v === 'org-bbbb')).toBe(false)
  })
})
