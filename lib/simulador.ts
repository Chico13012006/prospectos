// Simulador comercial (sprint item 6). Preços e regra de desconto do projeto de
// automação de estoque RFID da iNOVACODE.
//
// ⚠️ REGRA DE NEGÓCIO IMPORTANTE: NÃO existe fórmula fixa de precificação — o
// Chico confirmou que preço de pacote é NEGOCIADO, não calculado. Por isso:
//   • A TABELA DE PREÇOS (PRODUTOS) é oficial e exata — não alterar sem o Chico.
//   • O DESCONTO de bundle abaixo é uma ESTIMATIVA INICIAL EDITÁVEL (constantes),
//     um ponto de partida pra sugerir um número — será calibrado depois numa
//     conversa com o Guilherme. Na tela, o vendedor sempre pode sobrescrever o
//     valor final (o que foi de fato negociado); o sistema só CALCULA e MOSTRA o
//     % de desconto sobre a tabela cheia, sem travar nada (v1 não tem teto de
//     aprovação — isso entra depois, quando houver dado real de uso).

export type ModeloComercial = 'compra' | 'comodato'
export type ProdutoId = 'coletor' | 'impressora' | 'totem' | 'pdv' | 'mesa_rfid'

export interface Produto {
  id: ProdutoId
  nome: string
  // Venda definitiva (modelo Compra).
  precoCompra: number
  // Mensalidade avulsa de referência (modelo Comodato, prazo fixo 24 meses).
  mensalComodato: number
}

// TABELA OFICIAL — valores exatos do prompt-mestre (04/08/2026). Não editar sem
// confirmação do Chico. (Compra: Totem e Mesa custam o mesmo, R$ 12.000.)
export const PRODUTOS: Produto[] = [
  { id: 'coletor', nome: 'Coletor', precoCompra: 8000, mensalComodato: 490 },
  { id: 'impressora', nome: 'Impressora', precoCompra: 9000, mensalComodato: 690 },
  { id: 'totem', nome: 'Totem', precoCompra: 12000, mensalComodato: 990 },
  { id: 'pdv', nome: 'PDV', precoCompra: 3990, mensalComodato: 290 },
  { id: 'mesa_rfid', nome: 'Mesa de conferência RFID', precoCompra: 12000, mensalComodato: 790 },
]

export const PRAZO_COMODATO_MESES = 24

const PRODUTO_POR_ID = new Map(PRODUTOS.map((p) => [p.id, p]))

// --- DESCONTO DE BUNDLE (comodato) — ESTIMATIVA EDITÁVEL, não fórmula fechada ---
// As faixas abaixo foram alinhadas aos 3 exemplos reais fornecidos pelo Chico
// (o desconto implícito de cada um), por nº de itens do pacote:
//   Coletor+Impressora (2 itens):         avulso 1180 → 590/mês  = 50% desconto
//   Coletor+Impressora+PDV (3 itens):     avulso 1470 → 690/mês  ≈ 53% desconto
//   2 Totens+Coletor+Impressora (4 itens): avulso 3160 → 1990/mês ≈ 37% desconto
// Os exemplos NÃO formam uma curva limpa (é negociação real): 4 itens dá MENOS
// desconto que 2/3 porque o Totem (item caro) puxa a conta. Por isso é uma tabela
// por faixa, não fórmula — ajustar quando calibrar com o Guilherme.
export const DESCONTO_BUNDLE_POR_QTD: { minItens: number; desconto: number }[] = [
  { minItens: 4, desconto: 0.37 },
  { minItens: 3, desconto: 0.53 },
  { minItens: 2, desconto: 0.50 },
  { minItens: 1, desconto: 0.0 }, // 1 item isolado = preço avulso de tabela
]

// Entrada estimada do comodato: ~R$ 1.500 por item (bate ex1 ≈ 2990 e ex3 ≈ 5990;
// o ex2 teve entrada zerada na negociação). Editável na tela. Estimativa inicial.
export const ENTRADA_ESTIMADA_POR_ITEM = 1500

export interface ItemProposta {
  produto: ProdutoId
  qtd: number
}

// Quantidade total de equipamentos (soma das qtds > 0).
export function totalItens(itens: ItemProposta[]): number {
  return itens.reduce((s, i) => s + (i.qtd > 0 ? i.qtd : 0), 0)
}

// Desconto de bundle sugerido para uma quantidade total de itens.
export function descontoBundle(qtdTotal: number): number {
  for (const faixa of DESCONTO_BUNDLE_POR_QTD) {
    if (qtdTotal >= faixa.minItens) return faixa.desconto
  }
  return 0
}

export interface ResultadoCompra {
  modelo: 'compra'
  valorTabela: number // soma dos preços de compra cheios
  valorSugerido: number // v1: igual à tabela (sem desconto automático na compra)
}

export interface ResultadoComodato {
  modelo: 'comodato'
  mensalTabela: number // soma das mensalidades avulsas cheias
  mensalSugerido: number // após desconto de bundle estimado
  entradaSugerida: number
  prazoMeses: number
  descontoSugerido: number // fração (0..1) aplicada à mensalidade
  totalContratoSugerido: number // entrada + prazo * mensal
}

function somaCompra(itens: ItemProposta[]): number {
  return itens.reduce((s, i) => {
    const p = PRODUTO_POR_ID.get(i.produto)
    return p && i.qtd > 0 ? s + p.precoCompra * i.qtd : s
  }, 0)
}

function somaMensalAvulsa(itens: ItemProposta[]): number {
  return itens.reduce((s, i) => {
    const p = PRODUTO_POR_ID.get(i.produto)
    return p && i.qtd > 0 ? s + p.mensalComodato * i.qtd : s
  }, 0)
}

export function calcularCompra(itens: ItemProposta[]): ResultadoCompra {
  const valorTabela = somaCompra(itens)
  return { modelo: 'compra', valorTabela, valorSugerido: valorTabela }
}

export function calcularComodato(itens: ItemProposta[]): ResultadoComodato {
  const mensalTabela = somaMensalAvulsa(itens)
  const qtd = totalItens(itens)
  const desconto = descontoBundle(qtd)
  const mensalSugerido = Math.round(mensalTabela * (1 - desconto))
  const entradaSugerida = qtd > 0 ? ENTRADA_ESTIMADA_POR_ITEM * qtd : 0
  return {
    modelo: 'comodato',
    mensalTabela,
    mensalSugerido,
    entradaSugerida,
    prazoMeses: PRAZO_COMODATO_MESES,
    descontoSugerido: desconto,
    totalContratoSugerido: entradaSugerida + mensalSugerido * PRAZO_COMODATO_MESES,
  }
}

// % de desconto de uma proposta vs. a tabela cheia (o número que a v1 mostra e
// registra). Positivo = abaixo da tabela. Arredonda a 1 casa. 0 se tabela=0.
export function percentualDesconto(valorTabela: number, valorFinal: number): number {
  if (valorTabela <= 0) return 0
  return Math.round((1 - valorFinal / valorTabela) * 1000) / 10
}

export function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}
