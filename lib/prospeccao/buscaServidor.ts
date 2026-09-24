// Busca de prospecção no servidor: RPCs da migration 0051 sobre o catálogo RF.
// `org` vem SEMPRE da sessão (resolverAcesso), nunca do payload.

import type { SupabaseClient } from '@supabase/supabase-js'
import { limitePagina, paramsRpc, type FiltrosBusca } from './filtros'
import { classificarEmail, type QualidadeEmail } from './qualidadeEmail'

export interface ResultadoCatalogo {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  cnae_principal: string
  cnaes_secundarios: string[]
  porte: string | null
  mei: boolean | null
  capital_social: number | null
  data_inicio_atividade: string | null
  logradouro: string | null
  numero: string | null
  bairro: string | null
  cep: string | null
  uf: string | null
  municipio: string | null
  telefone: string | null
  email: string | null
  ja_na_base: boolean
  lead_id: string | null
  qualidade_email: QualidadeEmail
}

export interface StatusCatalogo {
  mesRf: string
  concluidaEm: string | null
  cnaes: string[]
}

export interface RespostaBusca {
  itens: ResultadoCatalogo[]
  proximoCursor: string | null
  total: number | null
  catalogo: StatusCatalogo | null
}

export async function statusCatalogo(admin: SupabaseClient): Promise<StatusCatalogo | null> {
  const { data, error } = await admin
    .from('catalogo_rf_cargas')
    .select('mes_rf, concluida_em, cnaes')
    .eq('status', 'concluida')
    .order('concluida_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha ao ler status do catálogo: ${error.message}`)
  return data ? { mesRf: data.mes_rf, concluidaEm: data.concluida_em, cnaes: data.cnaes ?? [] } : null
}

export async function buscarProspeccao(
  admin: SupabaseClient,
  org: string,
  filtros: FiltrosBusca,
  cursor: string | null,
  opcoes: { contar: boolean; limite?: number }
): Promise<RespostaBusca> {
  // Sem CNAE a busca varreria o catálogo inteiro: a tela pede para configurar.
  if (filtros.cnaes.length === 0) {
    return { itens: [], proximoCursor: null, total: 0, catalogo: await statusCatalogo(admin) }
  }
  const params = paramsRpc(org, filtros)
  // Quantidade desejada: a página traz só o que falta (nunca mais que LIMITE_PAGINA).
  const limite = limitePagina(opcoes.limite)
  const [pagina, contagem, catalogo] = await Promise.all([
    admin.rpc('prospeccao_buscar', { ...params, p_apos_cnpj: cursor, p_limite: limite }),
    // Contagem só na primeira página: paginar não muda o total.
    opcoes.contar ? admin.rpc('prospeccao_contar', params) : Promise.resolve({ data: null, error: null }),
    statusCatalogo(admin),
  ])
  if (pagina.error) throw new Error(`Falha na busca: ${pagina.error.message}`)
  if (contagem.error) throw new Error(`Falha na contagem: ${contagem.error.message}`)

  const linhas = (pagina.data ?? []) as Omit<ResultadoCatalogo, 'qualidade_email'>[]
  const itens = linhas.map((l) => ({
    ...l,
    capital_social: l.capital_social === null ? null : Number(l.capital_social),
    qualidade_email: classificarEmail(l.email),
  }))
  return {
    itens,
    proximoCursor: itens.length === limite ? itens[itens.length - 1].cnpj : null,
    total: contagem.data === null ? null : Number(contagem.data),
    catalogo,
  }
}
