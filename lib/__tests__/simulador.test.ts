import { describe, it, expect } from 'vitest'
import {
  PRODUTOS, PRAZO_COMODATO_MESES, calcularCompra, calcularComodato,
  descontoBundle, percentualDesconto, valorComDesconto, totalItens, type ItemProposta,
} from '../simulador'

// Trava a TABELA OFICIAL: se alguém mexer num preço sem querer, o teste quebra.
describe('simulador — tabela oficial de preços (não mudar sem o Chico)', () => {
  const byId = Object.fromEntries(PRODUTOS.map((p) => [p.id, p]))
  it('preços de compra', () => {
    expect(byId.coletor.precoCompra).toBe(8000)
    expect(byId.impressora.precoCompra).toBe(9000)
    expect(byId.totem.precoCompra).toBe(12000)
    expect(byId.pdv.precoCompra).toBe(3990)
    expect(byId.mesa_rfid.precoCompra).toBe(12000)
  })
  it('mensalidades avulsas do comodato', () => {
    expect(byId.coletor.mensalComodato).toBe(490)
    expect(byId.impressora.mensalComodato).toBe(690)
    expect(byId.pdv.mensalComodato).toBe(290)
    expect(byId.mesa_rfid.mensalComodato).toBe(790)
    expect(byId.totem.mensalComodato).toBe(990)
  })
  it('prazo do comodato é 24 meses', () => {
    expect(PRAZO_COMODATO_MESES).toBe(24)
  })
})

describe('simulador — compra', () => {
  it('soma os preços de tabela por quantidade', () => {
    const itens: ItemProposta[] = [
      { produto: 'coletor', qtd: 2 }, // 16000
      { produto: 'impressora', qtd: 1 }, // 9000
    ]
    const r = calcularCompra(itens)
    expect(r.valorTabela).toBe(25000)
    expect(r.valorSugerido).toBe(25000) // sem desconto automático na compra
  })
})

// Os 3 exemplos reais do Chico: confere as SOMAS AVULSAS (âncora da calibração).
describe('simulador — comodato: somas avulsas dos exemplos oficiais', () => {
  it('Coletor + Impressora → 1180/mês avulso', () => {
    expect(calcularComodato([{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }]).mensalTabela).toBe(1180)
  })
  it('Coletor + Impressora + PDV → 1470/mês avulso', () => {
    expect(calcularComodato([
      { produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }, { produto: 'pdv', qtd: 1 },
    ]).mensalTabela).toBe(1470)
  })
  it('2 Totens + Coletor + Impressora → 3160/mês avulso', () => {
    expect(calcularComodato([
      { produto: 'totem', qtd: 2 }, { produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 },
    ]).mensalTabela).toBe(3160)
  })
})

describe('simulador — desconto de bundle (estimativa editável)', () => {
  it('faixas por quantidade de itens (alinhadas aos exemplos reais)', () => {
    expect(descontoBundle(1)).toBe(0)
    expect(descontoBundle(2)).toBe(0.50)
    expect(descontoBundle(3)).toBe(0.53)
    expect(descontoBundle(4)).toBe(0.37)
    expect(descontoBundle(10)).toBe(0.37)
  })
  it('sugestão do comodato bate o exemplo Coletor+Impressora (590/mês)', () => {
    const r = calcularComodato([{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }])
    expect(r.mensalTabela).toBe(1180)
    expect(r.descontoSugerido).toBe(0.50)
    expect(r.mensalSugerido).toBe(590) // round(1180 * 0.50) — igual ao exemplo do Chico
    expect(r.entradaSugerida).toBe(3000) // 2 itens * 1500 (exemplo real: 2990)
    expect(r.totalContratoSugerido).toBe(3000 + 590 * 24)
  })
})

describe('simulador — bidirecional (valor ↔ desconto, item 5)', () => {
  it('valorComDesconto aplica o % sobre a tabela e clampa em [0,100]', () => {
    expect(valorComDesconto(1000, 10)).toBe(900)
    expect(valorComDesconto(1180, 50)).toBe(590) // exemplo real Coletor+Impressora
    expect(valorComDesconto(1000, 0)).toBe(1000)
    expect(valorComDesconto(1000, -5)).toBe(1000) // % negativo → 0% desconto
    expect(valorComDesconto(1000, 150)).toBe(0) // acima de 100% → grátis
  })
  it('round-trip valor→%→valor não acumula erro (sempre parte da tabela)', () => {
    const tabela = 1470
    for (const pct of [5, 10, 15, 33, 47.5]) {
      const valor = valorComDesconto(tabela, pct)
      // O % derivado do valor recalculado bate com o pedido (dentro de 0.1pp).
      expect(Math.abs(percentualDesconto(tabela, valor) - pct)).toBeLessThanOrEqual(0.1)
      // Reaplicar o % derivado dá o MESMO valor (idempotente — sem drift).
      expect(valorComDesconto(tabela, percentualDesconto(tabela, valor))).toBe(valor)
    }
  })
})

describe('simulador — % de desconto e utilitários', () => {
  it('percentualDesconto compara final com a tabela cheia', () => {
    expect(percentualDesconto(1180, 590)).toBe(50)
    expect(percentualDesconto(1470, 690)).toBe(53.1)
    expect(percentualDesconto(3160, 1990)).toBe(37)
    expect(percentualDesconto(0, 0)).toBe(0) // não divide por zero
  })
  it('totalItens ignora quantidades zeradas/negativas', () => {
    expect(totalItens([{ produto: 'coletor', qtd: 2 }, { produto: 'pdv', qtd: 0 }])).toBe(2)
  })
})
