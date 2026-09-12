import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  statusLaudo,
  dataValidadeValida,
  sincronizarCicloAtual,
  renovarLaudo,
  criarCiclosIniciais,
} from '../ciclos'

const HOJE = new Date('2026-09-12T15:00:00.000Z')
const ORG = 'org-laudos'
const LEAD = 'lead-1'

// ---------------------------------------------------------------------------
// statusLaudo — regra pura
// ---------------------------------------------------------------------------
describe('statusLaudo', () => {
  it('vigente quando falta mais que a janela de alerta', () => {
    expect(statusLaudo('2026-12-01', null, 30, HOJE)).toBe('vigente')
    expect(statusLaudo('2026-10-13', null, 30, HOJE)).toBe('vigente') // 31 dias
  })

  it('próximo do vencimento dentro da janela, inclusive no limite e no dia', () => {
    expect(statusLaudo('2026-10-12', null, 30, HOJE)).toBe('proximo_vencimento') // 30 dias
    expect(statusLaudo('2026-09-20', null, 30, HOJE)).toBe('proximo_vencimento')
    expect(statusLaudo('2026-09-12', null, 30, HOJE)).toBe('proximo_vencimento') // vence hoje
  })

  it('vencido a partir do dia seguinte à validade', () => {
    expect(statusLaudo('2026-09-11', null, 30, HOJE)).toBe('vencido')
    expect(statusLaudo('2026-03-01', null, 30, HOJE)).toBe('vencido')
  })

  it('a janela de alerta é configurável (30 é só o padrão)', () => {
    expect(statusLaudo('2026-10-12', null, 45, HOJE)).toBe('proximo_vencimento')
    expect(statusLaudo('2026-10-12', null, 7, HOJE)).toBe('vigente')
  })

  it('renovado tem precedência: ciclo encerrado nunca é vigente/vencido', () => {
    expect(statusLaudo('2026-03-01', '2026-04-01T10:00:00Z', 30, HOJE)).toBe('renovado')
    expect(statusLaudo('2027-01-01', '2026-09-12T10:00:00Z', 30, HOJE)).toBe('renovado')
  })

  it('sem data válida → null (lead sem validade)', () => {
    expect(statusLaudo(null, null, 30, HOJE)).toBeNull()
    expect(statusLaudo('', null, 30, HOJE)).toBeNull()
    expect(statusLaudo('não é data', null, 30, HOJE)).toBeNull()
  })
})

describe('dataValidadeValida', () => {
  it('aceita só AAAA-MM-DD que existe', () => {
    expect(dataValidadeValida('2026-09-12')).toBe(true)
    expect(dataValidadeValida('2026-02-31')).toBe(false)
    expect(dataValidadeValida('12/09/2026')).toBe(false)
    expect(dataValidadeValida('')).toBe(false)
    expect(dataValidadeValida(null)).toBe(false)
    expect(dataValidadeValida(20260912)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Client Supabase falso: grava cada chamada (tabela, verbo, filtros, payload)
// e devolve o que o teste programar. Serve para provar a ORDEM das escritas,
// o escopo por organizacao_id e o que NÃO foi tocado.
// ---------------------------------------------------------------------------
interface Chamada {
  table: string
  verbo: 'select' | 'update' | 'insert' | 'delete'
  filtros: Record<string, unknown>
  payload?: unknown
}
type Resposta = { data?: unknown; error?: { message: string; code?: string } | null }
type Roteiro = (c: Chamada) => Resposta

function fakeAdmin(roteiro: Roteiro) {
  const chamadas: Chamada[] = []
  function builder(table: string) {
    const c: Chamada = { table, verbo: 'select', filtros: {} }
    const resolver = () => {
      chamadas.push(c)
      const r = roteiro(c)
      return { data: r.data ?? null, error: r.error ?? null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      update: (p: unknown) => { c.verbo = 'update'; c.payload = p; return b },
      insert: (p: unknown) => { c.verbo = 'insert'; c.payload = p; return b },
      delete: () => { c.verbo = 'delete'; return b },
      eq: (k: string, v: unknown) => { c.filtros[k] = v; return b },
      is: (k: string, v: unknown) => { c.filtros[k] = v; return b },
      maybeSingle: () => Promise.resolve(resolver()),
      single: () => Promise.resolve(resolver()),
      // await direto no builder (sem single): resolve como lista
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, ko),
    }
    return b
  }
  const client = { from: (t: string) => builder(t) } as unknown as SupabaseClient
  return { client, chamadas }
}

const escopadas = (chamadas: Chamada[]) => chamadas.every((c) => c.filtros.organizacao_id === ORG || (c.verbo === 'insert' && temOrg(c.payload)))
const temOrg = (p: unknown) => Array.isArray(p)
  ? p.every((x) => (x as Record<string, unknown>).organizacao_id === ORG)
  : (p as Record<string, unknown>)?.organizacao_id === ORG

// ---------------------------------------------------------------------------
// CORREÇÃO de validade — sincronizarCicloAtual
// ---------------------------------------------------------------------------
describe('sincronizarCicloAtual (corrigir validade — NÃO é renovação)', () => {
  it('lead sem ciclo + validade → cria o primeiro ciclo', async () => {
    const { client, chamadas } = fakeAdmin((c) => c.verbo === 'select' ? { data: null } : {})
    const r = await sincronizarCicloAtual(client, ORG, LEAD, '2026-12-01')
    expect(r).toBe('criado')
    const ins = chamadas.find((c) => c.verbo === 'insert')!
    expect(ins.table).toBe('laudo_ciclos')
    expect(ins.payload).toEqual({ organizacao_id: ORG, lead_id: LEAD, validade_em: '2026-12-01' })
    expect(chamadas.some((c) => c.verbo === 'update')).toBe(false)
    expect(escopadas(chamadas)).toBe(true)
  })

  it('ciclo atual existe e a data mudou → atualiza validade_em, sem encerrar nem criar', async () => {
    const { client, chamadas } = fakeAdmin((c) =>
      c.verbo === 'select' ? { data: { id: 'c1', validade_em: '2026-10-01' } } : {})
    const r = await sincronizarCicloAtual(client, ORG, LEAD, '2026-11-15')
    expect(r).toBe('atualizado')
    const upd = chamadas.find((c) => c.verbo === 'update')!
    expect(upd.table).toBe('laudo_ciclos')
    expect(upd.filtros).toMatchObject({ id: 'c1', organizacao_id: ORG })
    expect(upd.payload).toEqual({ validade_em: '2026-11-15' })
    // Não é renovação: nada de renovado_em, nada de insert, leads não é tocado aqui.
    expect(upd.payload).not.toHaveProperty('renovado_em')
    expect(chamadas.some((c) => c.verbo === 'insert')).toBe(false)
    expect(chamadas.some((c) => c.table === 'leads')).toBe(false)
    expect(escopadas(chamadas)).toBe(true)
  })

  it('mesma data → inalterado, nenhuma escrita', async () => {
    const { client, chamadas } = fakeAdmin((c) =>
      c.verbo === 'select' ? { data: { id: 'c1', validade_em: '2026-10-01' } } : {})
    const r = await sincronizarCicloAtual(client, ORG, LEAD, '2026-10-01')
    expect(r).toBe('inalterado')
    expect(chamadas.filter((c) => c.verbo !== 'select')).toHaveLength(0)
  })

  it('validade apagada (null) → remove só o ciclo atual; histórico renovado fica', async () => {
    const { client, chamadas } = fakeAdmin((c) =>
      c.verbo === 'select' ? { data: { id: 'c1', validade_em: '2026-10-01' } } : {})
    const r = await sincronizarCicloAtual(client, ORG, LEAD, null)
    expect(r).toBe('removido')
    const del = chamadas.find((c) => c.verbo === 'delete')!
    expect(del.table).toBe('laudo_ciclos')
    expect(del.filtros).toEqual({ id: 'c1', organizacao_id: ORG }) // pelo id do ATUAL, não por lead
    // o select do atual filtra renovado_em IS NULL — o histórico não entra
    expect(chamadas[0].filtros).toMatchObject({ lead_id: LEAD, organizacao_id: ORG, renovado_em: null })
  })

  it('null sem ciclo → inalterado', async () => {
    const { client, chamadas } = fakeAdmin(() => ({ data: null }))
    expect(await sincronizarCicloAtual(client, ORG, LEAD, null)).toBe('inalterado')
    expect(chamadas).toHaveLength(1)
  })

  it('erro de banco é propagado, não engolido', async () => {
    const { client } = fakeAdmin(() => ({ error: { message: 'boom' } }))
    await expect(sincronizarCicloAtual(client, ORG, LEAD, '2026-12-01')).rejects.toThrow('boom')
  })
})

// ---------------------------------------------------------------------------
// RENOVAÇÃO — renovarLaudo
// ---------------------------------------------------------------------------
describe('renovarLaudo (marcar como renovado)', () => {
  const roteiroFeliz: Roteiro = (c) => {
    if (c.table === 'laudo_ciclos' && c.verbo === 'update') return { data: { id: 'c1', validade_em: '2026-09-25' } }
    if (c.table === 'laudo_ciclos' && c.verbo === 'insert') return { data: { id: 'c2', validade_em: '2027-09-25' } }
    if (c.table === 'tarefas') return { data: [{ id: 't1' }] }
    return {}
  }

  it('encerra o atual (vira histórico), abre o novo, espelha em leads e fecha a tarefa — nessa ordem', async () => {
    const { client, chamadas } = fakeAdmin(roteiroFeliz)
    const r = await renovarLaudo(client, ORG, LEAD, '2027-09-25')

    expect(chamadas.map((c) => `${c.table}:${c.verbo}`)).toEqual([
      'laudo_ciclos:update',   // 1) encerra o atual
      'laudo_ciclos:insert',   // 2) abre o novo
      'leads:update',          // 3) espelha data_validade
      'tarefas:update',        // 4) fecha tarefa de renovação aberta
    ])

    const fechar = chamadas[0]
    expect(fechar.filtros).toMatchObject({ organizacao_id: ORG, lead_id: LEAD, renovado_em: null })
    expect((fechar.payload as { renovado_em: string }).renovado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // preserva a validade anterior: NÃO altera validade_em do ciclo fechado
    expect(fechar.payload).not.toHaveProperty('validade_em')

    expect(chamadas[1].payload).toEqual({ organizacao_id: ORG, lead_id: LEAD, validade_em: '2027-09-25' })

    expect(chamadas[2].filtros).toEqual({ id: LEAD, organizacao_id: ORG })
    expect(chamadas[2].payload).toEqual({ data_validade: '2027-09-25' })

    expect(chamadas[3].filtros).toMatchObject({ organizacao_id: ORG, lead_id: LEAD, tipo: 'renovacao', status: 'aberta' })
    expect(chamadas[3].payload).toMatchObject({ status: 'concluida' })

    expect(r).toEqual({
      cicloAnterior: { id: 'c1', validade_em: '2026-09-25' },
      cicloAtual: { id: 'c2', validade_em: '2027-09-25' },
      tarefasFechadas: 1,
    })
    expect(escopadas(chamadas)).toBe(true)
  })

  it('lead sem ciclo atual → abre o primeiro; cicloAnterior é null', async () => {
    const { client, chamadas } = fakeAdmin((c) => {
      if (c.table === 'laudo_ciclos' && c.verbo === 'update') return { data: null } // nada para fechar
      if (c.table === 'laudo_ciclos' && c.verbo === 'insert') return { data: { id: 'c1', validade_em: '2027-01-01' } }
      if (c.table === 'tarefas') return { data: [] }
      return {}
    })
    const r = await renovarLaudo(client, ORG, LEAD, '2027-01-01')
    expect(r.cicloAnterior).toBeNull()
    expect(r.cicloAtual).toEqual({ id: 'c1', validade_em: '2027-01-01' })
    expect(r.tarefasFechadas).toBe(0)
    expect(chamadas.some((c) => c.table === 'leads' && c.verbo === 'update')).toBe(true)
  })

  it('renovar duas vezes: o segundo ciclo vira histórico e o terceiro é o atual', async () => {
    let atual = { id: 'c1', validade_em: '2026-09-25' }
    let n = 1
    const { client } = fakeAdmin((c) => {
      if (c.table === 'laudo_ciclos' && c.verbo === 'update') return { data: atual }
      if (c.table === 'laudo_ciclos' && c.verbo === 'insert') {
        n++
        atual = { id: `c${n}`, validade_em: (c.payload as { validade_em: string }).validade_em }
        return { data: atual }
      }
      if (c.table === 'tarefas') return { data: [] }
      return {}
    })
    const r1 = await renovarLaudo(client, ORG, LEAD, '2027-09-25')
    const r2 = await renovarLaudo(client, ORG, LEAD, '2028-09-25')
    expect(r1.cicloAnterior?.id).toBe('c1'); expect(r1.cicloAtual.id).toBe('c2')
    expect(r2.cicloAnterior?.id).toBe('c2'); expect(r2.cicloAtual.id).toBe('c3')
    // O status do novo ciclo é pela data — não existe "lead renovado":
    expect(statusLaudo(r2.cicloAtual.validade_em, null, 30, HOJE)).toBe('vigente')
    expect(statusLaudo(r2.cicloAnterior!.validade_em, '2026-09-12T00:00:00Z', 30, HOJE)).toBe('renovado')
  })

  it('se abrir o novo ciclo falhar, reabre o anterior (compensação) e lança', async () => {
    const { client, chamadas } = fakeAdmin((c) => {
      if (c.table === 'laudo_ciclos' && c.verbo === 'update' && 'renovado_em' in (c.payload as object) && (c.payload as { renovado_em: unknown }).renovado_em !== null)
        return { data: { id: 'c1', validade_em: '2026-09-25' } }
      if (c.table === 'laudo_ciclos' && c.verbo === 'insert') return { error: { message: 'unique violation', code: '23505' } }
      return {}
    })
    await expect(renovarLaudo(client, ORG, LEAD, '2027-09-25')).rejects.toThrow('unique violation')
    const reabre = chamadas.find((c) => c.verbo === 'update' && (c.payload as { renovado_em: unknown }).renovado_em === null)!
    expect(reabre).toBeTruthy()
    expect(reabre.filtros).toEqual({ id: 'c1', organizacao_id: ORG })
    // leads e tarefas NÃO foram tocados
    expect(chamadas.some((c) => c.table === 'leads' || c.table === 'tarefas')).toBe(false)
  })

  it('falha ao fechar a tarefa NÃO derruba a renovação (background)', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = fakeAdmin((c) => {
      if (c.table === 'laudo_ciclos' && c.verbo === 'update') return { data: { id: 'c1', validade_em: '2026-09-25' } }
      if (c.table === 'laudo_ciclos' && c.verbo === 'insert') return { data: { id: 'c2', validade_em: '2027-09-25' } }
      if (c.table === 'tarefas') return { error: { message: 'tarefas indisponível' } }
      return {}
    })
    const r = await renovarLaudo(client, ORG, LEAD, '2027-09-25')
    expect(r.cicloAtual.id).toBe('c2')
    expect(r.tarefasFechadas).toBe(0)
    consoleWarn.mockRestore()
  })

  it('data inválida é recusada antes de qualquer escrita', async () => {
    const { client, chamadas } = fakeAdmin(() => ({}))
    await expect(renovarLaudo(client, ORG, LEAD, '31/02/2027')).rejects.toThrow(/inválida/)
    await expect(renovarLaudo(client, ORG, LEAD, '2027-02-31')).rejects.toThrow(/inválida/)
    expect(chamadas).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Importação — criarCiclosIniciais
// ---------------------------------------------------------------------------
describe('criarCiclosIniciais (importação)', () => {
  it('cria um ciclo por lead com validade, numa inserção só, escopado à org', async () => {
    const { client, chamadas } = fakeAdmin(() => ({}))
    const n = await criarCiclosIniciais(client, ORG, [
      { id: 'a', data_validade: '2026-11-01' },
      { id: 'b', data_validade: null },
      { id: 'c', data_validade: '2027-01-15' },
    ])
    expect(n).toBe(2)
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].payload).toEqual([
      { organizacao_id: ORG, lead_id: 'a', validade_em: '2026-11-01' },
      { organizacao_id: ORG, lead_id: 'c', validade_em: '2027-01-15' },
    ])
  })

  it('nenhum lead com validade → nenhuma chamada', async () => {
    const { client, chamadas } = fakeAdmin(() => ({}))
    expect(await criarCiclosIniciais(client, ORG, [{ id: 'a', data_validade: null }])).toBe(0)
    expect(chamadas).toHaveLength(0)
  })
})
