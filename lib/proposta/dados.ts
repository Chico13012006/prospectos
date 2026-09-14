// Normalização dos dados da proposta em PDF. Recebe o que o Simulador já
// decidiu (modalidade, itens, valores FINAIS negociados — override do vendedor
// ou sugestão) e devolve só o que o template desenha. Nada aqui calcula preço
// nem consulta a tabela: a única fonte de verdade continua sendo
// lib/simulador.ts + os overrides do vendedor. Valores de tabela, % de
// desconto e referências não entram na assinatura — o PDF não tem como
// vazá-los.

import { PRODUTOS, type ItemProposta, type ModeloComercial, type ProdutoId } from '@/lib/simulador'
import { PROPOSTA_LIMITE_ITENS } from './config'

export interface EquipamentoProposta {
  produto: ProdutoId // localiza o thumbnail em public/proposta/produtos
  qtd: number
  nome: string // já no singular/plural certo
  descricao?: string
}

export type FinanceiroProposta =
  | { tipo: 'compra'; investimento: number }
  | { tipo: 'comodato'; entrada: number; mensal: number; prazoMeses: number }

export interface PropostaPdfData {
  modalidade: ModeloComercial
  titulo: string
  subtitulo: string
  equipamentos: EquipamentoProposta[]
  financeiro: FinanceiroProposta
}

// Nome comercial voltado ao cliente. O totem é UM produto integrado (leitor +
// antena + estrutura ficam internos). PDV e Mesa usam o nome de PRODUTOS, sem
// plural nem copy inventados. `descricao` é opcional — só o totem tem por ora.
const NOMES_COMERCIAIS: Partial<Record<ProdutoId, { singular: string; plural: string; descricao?: string }>> = {
  impressora: { singular: 'Impressora RFID', plural: 'Impressoras RFID' },
  totem: {
    singular: 'Totem RFID integrado',
    plural: 'Totens RFID integrados',
    descricao: 'Leitura automatizada de entradas e saídas com alta performance',
  },
  coletor: { singular: 'Coletor RFID', plural: 'Coletores RFID' },
}

// Ordem de exibição no PDF (segue a arte aprovada); demais produtos vêm depois
// na ordem de PRODUTOS.
const ORDEM_EXIBICAO: ProdutoId[] = ['impressora', 'totem', 'coletor']

export function nomeComercial(produto: ProdutoId, qtd: number): string {
  const mapeado = NOMES_COMERCIAIS[produto]
  if (mapeado) return qtd > 1 ? mapeado.plural : mapeado.singular
  return PRODUTOS.find((p) => p.id === produto)?.nome ?? produto
}

export function equipamentosProposta(itens: ItemProposta[]): EquipamentoProposta[] {
  const posicao = (id: ProdutoId) => {
    const i = ORDEM_EXIBICAO.indexOf(id)
    return i >= 0 ? i : ORDEM_EXIBICAO.length + PRODUTOS.findIndex((p) => p.id === id)
  }
  return itens
    .filter((i) => i.qtd > 0)
    .sort((a, b) => posicao(a.produto) - posicao(b.produto))
    .map((i) => ({
      produto: i.produto,
      qtd: i.qtd,
      nome: nomeComercial(i.produto, i.qtd),
      ...(NOMES_COMERCIAIS[i.produto]?.descricao ? { descricao: NOMES_COMERCIAIS[i.produto]!.descricao } : {}),
    }))
}

export function excedeLimiteItens(itens: ItemProposta[]): boolean {
  return itens.filter((i) => i.qtd > 0).length > PROPOSTA_LIMITE_ITENS
}

export interface EntradaProposta {
  modelo: ModeloComercial
  itens: ItemProposta[]
  // Valores FINAIS que o card "Resumo da proposta" exibe (override ou sugestão).
  valorFinal: number
  mensalFinal: number
  entradaFinal: number
  prazoMeses: number
}

export function montarDadosProposta(e: EntradaProposta): PropostaPdfData {
  const equipamentos = equipamentosProposta(e.itens)
  if (e.modelo === 'compra') {
    return {
      modalidade: 'compra',
      titulo: 'MODELO COMPRA — IMPLANTAÇÃO RFID',
      subtitulo: 'IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID',
      equipamentos,
      financeiro: { tipo: 'compra', investimento: e.valorFinal },
    }
  }
  return {
    modalidade: 'comodato',
    titulo: 'MODELO COMODATO — IMPLANTAÇÃO RFID',
    subtitulo: `IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID — CONTRATO DE ${e.prazoMeses} MESES`,
    equipamentos,
    financeiro: { tipo: 'comodato', entrada: e.entradaFinal, mensal: e.mensalFinal, prazoMeses: e.prazoMeses },
  }
}

// Sempre com centavos ("R$ 3.000,00"), mesmo zerados — diferente do
// formatarBRL do simulador, que arredonda para inteiro na tela interna.
// O espaço após "R$" vem como NBSP do Intl; normaliza para espaço comum.
export function formatarBRLCentavos(valor: number): string {
  return valor
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\u00a0/g, ' ')
}

// "02" — duas casas como na arte aprovada.
export function formatarQtd(qtd: number): string {
  return String(qtd).padStart(2, '0')
}

// Data local (não UTC): depois das 21h BRT `toISOString()` já cai no dia
// seguinte, e o nome do arquivo deve bater com a data que o vendedor vê.
export function dataLocalISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// "CBA Indústria & Comércio" → "cba-industria-comercio". Sem acentos, só
// [a-z0-9] e hífens, máx. 40 caracteres, sem hífen nas pontas.
export function slugCliente(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

// proposta-{empresa}-{data}.pdf quando há lead selecionado; proposta-{data}.pdf
// caso contrário.
export function nomeArquivoProposta(empresa?: string | null, data: Date = new Date()): string {
  const slug = empresa ? slugCliente(empresa) : ''
  return slug ? `proposta-${slug}-${dataLocalISO(data)}.pdf` : `proposta-${dataLocalISO(data)}.pdf`
}
