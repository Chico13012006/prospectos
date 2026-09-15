import { describe, it, expect } from 'vitest'
import { normalizarProposta } from '../normalizar'

// O servidor só confia nas escolhas do vendedor (lead, modelo, itens, valores
// finais). Tabela, total e snapshot do PDF são recalculados — e o PDF nunca
// carrega tabela nem desconto.

const COMODATO = {
  leadId: 'L1',
  modelo: 'comodato',
  itens: [{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }],
  valorFinal: 0,
  mensalFinal: 590,
  entradaFinal: 3000,
}

function ok(bruto: unknown) {
  const r = normalizarProposta(bruto)
  if (!r.ok) throw new Error(`esperava ok, veio: ${r.mensagem}`)
  return r.proposta
}

describe('normalizarProposta — comodato', () => {
  it('recalcula tabela e total no servidor e monta o snapshot do PDF (caso da tela: R$ 17.160)', () => {
    const p = ok(COMODATO)
    expect(p).toMatchObject({
      leadId: 'L1', modelo: 'comodato',
      mensalFinal: 590, entradaFinal: 3000, prazoMeses: 24, valorFinal: 0,
      mensalTabela: 1180, entradaTabela: 3000, valorTabela: 0,
      total: 17160,
    })
    expect(p.dadosPdf.financeiro).toEqual({ tipo: 'comodato', entrada: 3000, mensal: 590, prazoMeses: 24 })
    expect(p.dadosPdf.equipamentos.map((e) => e.produto)).toEqual(['impressora', 'coletor'])
  })

  it('ignora referências, total e PDF vindos do browser', () => {
    const p = ok({ ...COMODATO, mensalTabela: 1, valorTabela: 999, total: 5, dadosPdf: { adulterado: true } })
    expect(p.mensalTabela).toBe(1180)
    expect(p.total).toBe(17160)
    expect(p.dadosPdf).not.toHaveProperty('adulterado')
  })

  it('snapshot do PDF não carrega tabela nem desconto', () => {
    const json = JSON.stringify(ok(COMODATO).dadosPdf)
    expect(json).not.toContain('1180')
    expect(json).not.toMatch(/tabela|desconto/i)
  })

  it('aceita entrada zero (negociação real) e arredonda valores a centavos', () => {
    const p = ok({ ...COMODATO, entradaFinal: 0, mensalFinal: 590.456 })
    expect(p.entradaFinal).toBe(0)
    expect(p.mensalFinal).toBe(590.46)
    expect(p.total).toBe(14171.04)
  })

  it('descarta itens com quantidade zero', () => {
    const p = ok({ ...COMODATO, itens: [...COMODATO.itens, { produto: 'totem', qtd: 0 }] })
    expect(p.itens).toEqual([{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }])
  })
})

describe('normalizarProposta — compra', () => {
  it('valor final negociado, tabela oficial e sem mensal/entrada/prazo', () => {
    const p = ok({
      leadId: 'L1', modelo: 'compra',
      itens: [{ produto: 'coletor', qtd: 2 }, { produto: 'impressora', qtd: 1 }],
      valorFinal: 21000, mensalFinal: 590, entradaFinal: 3000,
    })
    expect(p).toMatchObject({
      modelo: 'compra', valorFinal: 21000, valorTabela: 25000, total: 21000,
      mensalFinal: 0, entradaFinal: 0, prazoMeses: null, mensalTabela: 0, entradaTabela: 0,
    })
    expect(p.dadosPdf.financeiro).toEqual({ tipo: 'compra', investimento: 21000 })
  })
})

describe('normalizarProposta — rejeições', () => {
  const casos: Array<[string, unknown]> = [
    ['sem corpo', null],
    ['sem lead', { ...COMODATO, leadId: '  ' }],
    ['modelo inválido', { ...COMODATO, modelo: 'aluguel' }],
    ['itens não é lista', { ...COMODATO, itens: 'coletor' }],
    ['produto desconhecido', { ...COMODATO, itens: [{ produto: 'drone', qtd: 1 }] }],
    ['quantidade fracionária', { ...COMODATO, itens: [{ produto: 'coletor', qtd: 1.5 }] }],
    ['quantidade negativa', { ...COMODATO, itens: [{ produto: 'coletor', qtd: -1 }] }],
    ['item repetido', { ...COMODATO, itens: [{ produto: 'coletor', qtd: 1 }, { produto: 'coletor', qtd: 2 }] }],
    ['nenhum equipamento', { ...COMODATO, itens: [{ produto: 'coletor', qtd: 0 }] }],
    ['mensalidade zero', { ...COMODATO, mensalFinal: 0 }],
    ['entrada negativa', { ...COMODATO, entradaFinal: -1 }],
    ['valor como texto', { ...COMODATO, mensalFinal: '590' }],
    ['valor não finito', { ...COMODATO, mensalFinal: Number.POSITIVE_INFINITY }],
    ['valor absurdo', { ...COMODATO, mensalFinal: 1e12 }],
    ['compra com valor zero', { ...COMODATO, modelo: 'compra', valorFinal: 0 }],
  ]
  for (const [nome, bruto] of casos) {
    it(nome, () => {
      const r = normalizarProposta(bruto)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.mensagem).toBeTruthy()
    })
  }
})
