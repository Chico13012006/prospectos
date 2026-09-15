// Validação e derivação de uma proposta ANTES de gravar. Roda no servidor
// (rota POST /api/propostas) sobre o JSON que veio do browser.
//
// O browser só decide o que é escolha do vendedor: lead, modelo, itens e
// valores FINAIS negociados. Tudo o que é derivado — referências da tabela
// oficial, total do contrato e o snapshot do PDF — é recalculado aqui a partir
// de lib/simulador.ts, a mesma fonte de verdade da tela. Um payload adulterado
// não consegue gravar tabela falsa nem colocar desconto/tabela no PDF
// (montarDadosProposta não recebe esses campos).

import {
  PRODUTOS, calcularCompra, calcularComodato,
  type ItemProposta, type ModeloComercial, type ProdutoId,
} from '@/lib/simulador'
import { PROPOSTA_LIMITE_ITENS } from '@/lib/proposta/config'
import { montarDadosProposta, type PropostaPdfData } from '@/lib/proposta/dados'

export interface PropostaNormalizada {
  leadId: string
  modelo: ModeloComercial
  itens: ItemProposta[]
  valorFinal: number
  mensalFinal: number
  entradaFinal: number
  prazoMeses: number | null
  valorTabela: number
  mensalTabela: number
  entradaTabela: number
  total: number
  dadosPdf: PropostaPdfData
}

export type ResultadoNormalizacao =
  | { ok: true; proposta: PropostaNormalizada }
  | { ok: false; mensagem: string }

// Limites de sanidade (não são regra comercial): barram lixo e overflow do
// numeric(12,2) sem restringir negociação real.
const VALOR_MAXIMO = 100_000_000
const QTD_MAXIMA = 9_999

const IDS_PRODUTO = new Set<string>(PRODUTOS.map((p) => p.id))

const erro = (mensagem: string): ResultadoNormalizacao => ({ ok: false, mensagem })
const centavos = (v: number) => Math.round(v * 100) / 100

// Valor monetário finito, não negativo, arredondado a centavos. null = inválido.
function valorMonetario(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > VALOR_MAXIMO) return null
  return centavos(v)
}

export function normalizarProposta(bruto: unknown): ResultadoNormalizacao {
  const e = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>

  const leadId = typeof e.leadId === 'string' ? e.leadId.trim() : ''
  if (!leadId) return erro('Selecione o lead da proposta.')

  const modelo = e.modelo
  if (modelo !== 'compra' && modelo !== 'comodato') return erro('Modelo comercial inválido.')

  if (!Array.isArray(e.itens)) return erro('Itens da proposta inválidos.')
  const itens: ItemProposta[] = []
  const vistos = new Set<string>()
  for (const itemBruto of e.itens) {
    const item = (itemBruto && typeof itemBruto === 'object' ? itemBruto : {}) as Record<string, unknown>
    if (typeof item.produto !== 'string' || !IDS_PRODUTO.has(item.produto)) {
      return erro('Equipamento desconhecido na proposta.')
    }
    if (typeof item.qtd !== 'number' || !Number.isInteger(item.qtd) || item.qtd < 0 || item.qtd > QTD_MAXIMA) {
      return erro('Quantidade de equipamento inválida.')
    }
    if (item.qtd === 0) continue
    if (vistos.has(item.produto)) return erro('Equipamento repetido na proposta.')
    vistos.add(item.produto)
    itens.push({ produto: item.produto as ProdutoId, qtd: item.qtd })
  }
  if (itens.length === 0) return erro('Adicione equipamentos à proposta.')
  // Mesmo limite do PDF: não se salva o que não dá para gerar nem enviar.
  if (itens.length > PROPOSTA_LIMITE_ITENS) {
    return erro(`A proposta comporta até ${PROPOSTA_LIMITE_ITENS} tipos de equipamento.`)
  }

  const comodato = calcularComodato(itens)

  if (modelo === 'compra') {
    const valorFinal = valorMonetario(e.valorFinal)
    if (valorFinal === null || valorFinal <= 0) return erro('Informe um valor final válido.')
    return {
      ok: true,
      proposta: {
        leadId, modelo, itens,
        valorFinal, mensalFinal: 0, entradaFinal: 0, prazoMeses: null,
        valorTabela: calcularCompra(itens).valorTabela, mensalTabela: 0, entradaTabela: 0,
        total: valorFinal,
        dadosPdf: montarDadosProposta({
          modelo, itens, valorFinal, mensalFinal: 0, entradaFinal: 0, prazoMeses: comodato.prazoMeses,
        }),
      },
    }
  }

  const mensalFinal = valorMonetario(e.mensalFinal)
  if (mensalFinal === null || mensalFinal <= 0) return erro('Informe uma mensalidade válida.')
  // Entrada zero é negociação legítima (há exemplo real com entrada zerada).
  const entradaFinal = valorMonetario(e.entradaFinal)
  if (entradaFinal === null) return erro('Informe uma entrada válida.')
  const prazoMeses = comodato.prazoMeses
  return {
    ok: true,
    proposta: {
      leadId, modelo, itens,
      valorFinal: 0, mensalFinal, entradaFinal, prazoMeses,
      valorTabela: 0, mensalTabela: comodato.mensalTabela, entradaTabela: comodato.entradaSugerida,
      total: centavos(entradaFinal + mensalFinal * prazoMeses),
      dadosPdf: montarDadosProposta({ modelo, itens, valorFinal: 0, mensalFinal, entradaFinal, prazoMeses }),
    },
  }
}
