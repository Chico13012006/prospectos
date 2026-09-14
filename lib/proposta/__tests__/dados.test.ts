import { describe, it, expect } from 'vitest'
import { calcularComodato, calcularCompra, type ItemProposta } from '../../simulador'
import {
  montarDadosProposta, equipamentosProposta, nomeComercial, excedeLimiteItens,
  formatarBRLCentavos, formatarQtd, nomeArquivoProposta, slugCliente, dataLocalISO,
} from '../dados'
import { PROPOSTA_LIMITE_ITENS } from '../config'

const ITENS_REF: ItemProposta[] = [
  { produto: 'coletor', qtd: 1 },
  { produto: 'impressora', qtd: 2 },
  { produto: 'totem', qtd: 4 },
]

describe('proposta — equipamentos (nome comercial, plural, descrição, ordem)', () => {
  it('singular com qtd 1 e plural natural com qtd > 1', () => {
    expect(nomeComercial('impressora', 1)).toBe('Impressora RFID')
    expect(nomeComercial('impressora', 2)).toBe('Impressoras RFID')
    expect(nomeComercial('coletor', 1)).toBe('Coletor RFID')
    expect(nomeComercial('coletor', 3)).toBe('Coletores RFID')
  })
  it('totem é UM produto integrado, com descrição', () => {
    expect(nomeComercial('totem', 1)).toBe('Totem RFID integrado')
    expect(nomeComercial('totem', 4)).toBe('Totens RFID integrados')
    const [totem] = equipamentosProposta([{ produto: 'totem', qtd: 4 }])
    expect(totem.descricao).toBe('Leitura automatizada de entradas e saídas com alta performance')
  })
  it('PDV e Mesa usam o nome de PRODUTOS, sem plural inventado nem descrição', () => {
    expect(nomeComercial('pdv', 3)).toBe('PDV')
    expect(nomeComercial('mesa_rfid', 2)).toBe('Mesa de conferência RFID')
    const eqs = equipamentosProposta([{ produto: 'pdv', qtd: 3 }, { produto: 'mesa_rfid', qtd: 2 }])
    expect(eqs.every((e) => e.descricao === undefined)).toBe(true)
  })
  it('segue a ordem da arte (impressora, totem, coletor) e ignora qtd 0', () => {
    const eqs = equipamentosProposta([...ITENS_REF, { produto: 'pdv', qtd: 0 }])
    expect(eqs.map((e) => `${e.qtd}x ${e.nome}`)).toEqual([
      '2x Impressoras RFID', '4x Totens RFID integrados', '1x Coletor RFID',
    ])
  })
})

describe('proposta — montarDadosProposta usa SOMENTE os valores finais', () => {
  it('comodato: título, subheader com prazo dinâmico e financeiro entrada + mensal', () => {
    const d = montarDadosProposta({
      modelo: 'comodato', itens: ITENS_REF, valorFinal: 999999, mensalFinal: 690, entradaFinal: 2990, prazoMeses: 36,
    })
    expect(d.modalidade).toBe('comodato')
    expect(d.titulo).toBe('MODELO COMODATO — IMPLANTAÇÃO RFID')
    expect(d.subtitulo).toBe('IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID — CONTRATO DE 36 MESES')
    expect(d.financeiro).toEqual({ tipo: 'comodato', entrada: 2990, mensal: 690, prazoMeses: 36 })
    expect(d.equipamentos).toHaveLength(3)
  })
  it('compra: título, subheader sem contrato e financeiro só com investimento', () => {
    const d = montarDadosProposta({
      modelo: 'compra', itens: ITENS_REF, valorFinal: 21000, mensalFinal: 690, entradaFinal: 2990, prazoMeses: 24,
    })
    expect(d.titulo).toBe('MODELO COMPRA — IMPLANTAÇÃO RFID')
    expect(d.subtitulo).toBe('IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID')
    expect(d.subtitulo).not.toMatch(/CONTRATO|MESES/)
    expect(d.financeiro).toEqual({ tipo: 'compra', investimento: 21000 })
  })
  it('valor negociado prevalece: nada de tabela, referência ou desconto nos dados', () => {
    const itens: ItemProposta[] = [{ produto: 'coletor', qtd: 2 }, { produto: 'impressora', qtd: 1 }]
    const tabela = calcularCompra(itens).valorTabela // 25000
    const negociado = 21000
    const d = montarDadosProposta({ modelo: 'compra', itens, valorFinal: negociado, mensalFinal: 0, entradaFinal: 0, prazoMeses: 24 })
    const json = JSON.stringify(d)
    expect(json).toContain(String(negociado))
    expect(json).not.toContain(String(tabela))
    expect(json).not.toMatch(/tabela|desconto|referencia|sugerid/i)

    const mensalTabela = calcularComodato(itens).mensalTabela // 1670
    const dc = montarDadosProposta({ modelo: 'comodato', itens, valorFinal: 0, mensalFinal: 800, entradaFinal: 2000, prazoMeses: 24 })
    expect(JSON.stringify(dc)).not.toContain(String(mensalTabela))
  })
})

describe('proposta — limite de equipamentos por página', () => {
  it(`até ${PROPOSTA_LIMITE_ITENS} tipos passa; acima excede`, () => {
    const cinco: ItemProposta[] = ['coletor', 'impressora', 'totem', 'pdv', 'mesa_rfid'].map((p) => ({ produto: p as ItemProposta['produto'], qtd: 1 }))
    expect(excedeLimiteItens(cinco)).toBe(false)
    expect(excedeLimiteItens([...cinco, { produto: 'coletor', qtd: 0 }])).toBe(false) // qtd 0 não conta
    const seis = [...cinco, { produto: 'novo_produto' as ItemProposta['produto'], qtd: 1 }]
    expect(excedeLimiteItens(seis)).toBe(true)
  })
})

describe('proposta — formatação para o cliente', () => {
  it('valores sempre com centavos, mesmo zerados', () => {
    expect(formatarBRLCentavos(3000)).toBe('R$ 3.000,00')
    expect(formatarBRLCentavos(690)).toBe('R$ 690,00')
    expect(formatarBRLCentavos(2990.5)).toBe('R$ 2.990,50')
    expect(formatarBRLCentavos(21000)).toBe('R$ 21.000,00')
    expect(formatarBRLCentavos(0)).toBe('R$ 0,00')
    expect(formatarBRLCentavos(3000)).not.toContain(' ') // sem NBSP do Intl
  })
  it('quantidade com duas casas', () => {
    expect(formatarQtd(1)).toBe('01')
    expect(formatarQtd(12)).toBe('12')
  })
})

describe('proposta — nome do arquivo', () => {
  const data = new Date(2026, 8, 13, 23, 30) // 13/09/2026 23:30 local
  it('slug sem acento/símbolo, minúsculo, hífens, máx. 40', () => {
    expect(slugCliente('CBA Indústria & Comércio')).toBe('cba-industria-comercio')
    expect(slugCliente('  --Açaí do João--  ')).toBe('acai-do-joao')
    expect(slugCliente('a'.repeat(60))).toHaveLength(40)
    expect(slugCliente('x'.repeat(39) + '-y')).not.toMatch(/-$/)
  })
  it('com lead: proposta-{empresa}-{data}.pdf; sem lead: proposta-{data}.pdf', () => {
    expect(nomeArquivoProposta('CBA Indústria', data)).toBe('proposta-cba-industria-2026-09-13.pdf')
    expect(nomeArquivoProposta(undefined, data)).toBe('proposta-2026-09-13.pdf')
    expect(nomeArquivoProposta('   ', data)).toBe('proposta-2026-09-13.pdf')
  })
  it('data é local (23:30 não vira o dia seguinte como em toISOString)', () => {
    expect(dataLocalISO(data)).toBe('2026-09-13')
  })
})
