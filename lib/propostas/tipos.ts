// Entidade Proposta (migration 0045) — tipos e textos compartilhados entre o
// browser (Simulador, abas Propostas) e as rotas /api/propostas. Sem nada de
// servidor aqui: o módulo é importado por componentes client.

import { PRODUTOS, formatarBRL, percentualDesconto, type ItemProposta, type ModeloComercial } from '@/lib/simulador'
import type { PropostaPdfData } from '@/lib/proposta/dados'

export type CanalEnvioProposta = 'email' | 'whatsapp'
export type StatusProposta = 'salva' | 'enviada'

// Lead mínimo de que a proposta precisa: nome do arquivo e destinos de envio.
export interface LeadDaProposta {
  id: string
  empresa: string
  contato_nome: string | null
  contato_email: string | null
  contato_telefone: string | null
}

export const COLUNAS_LEAD_PROPOSTA = 'id, empresa, contato_nome, contato_email, contato_telefone'

export interface PropostaRegistro {
  id: string
  lead_id: string
  modelo: ModeloComercial
  itens: ItemProposta[]
  valor_final: number
  mensal_final: number
  entrada_final: number
  prazo_meses: number | null
  valor_tabela: number
  mensal_tabela: number
  entrada_tabela: number
  total: number
  dados_pdf: PropostaPdfData
  status: StatusProposta
  criado_por_nome: string | null
  enviada_em: string | null
  enviada_canal: CanalEnvioProposta | null
  enviada_para: string | null
  envios: number
  criado_em: string
  leads: LeadDaProposta | null
}

// Colunas de `propostas` lidas pela UI (tudo menos trava e auditoria interna).
export const COLUNAS_PROPOSTA =
  'id, lead_id, modelo, itens, valor_final, mensal_final, entrada_final, prazo_meses, ' +
  'valor_tabela, mensal_tabela, entrada_tabela, total, dados_pdf, status, criado_por_nome, ' +
  'enviada_em, enviada_canal, enviada_para, envios, criado_em'

// O que o Simulador manda para salvar: só escolhas do vendedor. Tabela,
// desconto, total e o snapshot do PDF são derivados no servidor
// (lib/propostas/normalizar.ts).
export interface EntradaProposta {
  leadId: string
  modelo: ModeloComercial
  itens: ItemProposta[]
  valorFinal: number
  mensalFinal: number
  entradaFinal: number
}

// Texto que acompanha a proposta (corpo do e-mail ou legenda do WhatsApp).
export const LIMITE_MENSAGEM_ENVIO = 4000

export function resumoItens(itens: ItemProposta[]): string {
  const nome = (id: string) => PRODUTOS.find((p) => p.id === id)?.nome ?? id
  return itens.map((i) => `${i.qtd}x ${nome(i.produto)}`).join(', ')
}

// Numeric do Postgres pode chegar como string dependendo do driver: normaliza.
const n = (v: number | string | null | undefined) => Number(v ?? 0)

// % de desconto sobre a tabela (interno). Derivado, nunca armazenado.
export function descontoProposta(
  p: Pick<PropostaRegistro, 'modelo' | 'valor_final' | 'valor_tabela' | 'mensal_final' | 'mensal_tabela'>,
): number {
  return p.modelo === 'compra'
    ? percentualDesconto(n(p.valor_tabela), n(p.valor_final))
    : percentualDesconto(n(p.mensal_tabela), n(p.mensal_final))
}

export function valoresProposta(
  p: Pick<PropostaRegistro, 'modelo' | 'valor_final' | 'mensal_final' | 'entrada_final' | 'prazo_meses' | 'total'>,
): { principal: string; detalhe: string | null } {
  if (p.modelo === 'compra') return { principal: formatarBRL(n(p.valor_final)), detalhe: null }
  return {
    principal: `${formatarBRL(n(p.mensal_final))}/mês`,
    detalhe: `entrada ${formatarBRL(n(p.entrada_final))} · ${p.prazo_meses ?? '—'} meses · total ${formatarBRL(n(p.total))}`,
  }
}

// "GUILHERME CARRAPATOSO" → "Guilherme". Vazio quando não há nome.
export function primeiroNome(nome: string | null | undefined): string {
  const primeiro = nome?.trim().split(/\s+/)[0] ?? ''
  return primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : ''
}

export function assuntoPadraoProposta(empresa: string | null | undefined): string {
  return empresa?.trim() ? `Proposta comercial — ${empresa.trim()}` : 'Proposta comercial'
}

// Texto inicial sugerido; o vendedor edita antes de enviar. A assinatura do
// e-mail vem do template (responsável do lead), por isso não entra aqui.
export function mensagemPadraoProposta(
  canal: CanalEnvioProposta,
  lead: Pick<LeadDaProposta, 'contato_nome' | 'empresa'>,
): string {
  const nome = primeiroNome(lead.contato_nome)
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!'
  const paraEmpresa = lead.empresa?.trim() ? ` para a ${lead.empresa.trim()}` : ''
  if (canal === 'email') {
    return `${saudacao}\n\nConforme conversamos, segue em anexo a proposta comercial${paraEmpresa}.\n\nFico à disposição para qualquer dúvida.`
  }
  return `${saudacao} Segue a proposta comercial${paraEmpresa}. Qualquer dúvida, estou à disposição.`
}

export const ROTULO_CANAL: Record<CanalEnvioProposta, string> = { email: 'e-mail', whatsapp: 'WhatsApp' }
