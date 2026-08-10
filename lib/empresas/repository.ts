// Repository de compatibilidade (Fase 2c) — SERVER-ONLY, fino (só I/O). A regra
// de merge/fonte-da-verdade vive em ./view (pura e testada). Nada aqui altera
// telas ou o motor: é uma camada opt-in, ligada nas telas só depois do
// write-sync transacional (Fase 2d). Sempre escopado por organizacao_id (o
// client de service_role bypassa RLS, então o filtro explícito é obrigatório).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  montarEmpresaView,
  montarContatoView,
  type EmpresaView,
  type ContatoView,
  type EmpresaRow,
  type ContatoRow,
  type LeadCompat,
} from './view'

const CAMPOS_LEAD =
  'id, empresa, cidade, estado, segmento, site, dominio, origem, contato_nome, contato_cargo, contato_email, contato_telefone, empresa_id, contato_id'

// Empresa + contato "como entidade" a partir de um lead, aplicando a fonte-da-
// verdade da transição (leads autoritativo p/ core; entidade p/ campos próprios;
// fallback legado quando não há vínculo). Retorna null se o lead não existe.
export async function resolverEntidadesDoLead(
  org: string,
  leadId: string,
  client?: SupabaseClient,
): Promise<{ empresa: EmpresaView; contato: ContatoView } | null> {
  const db = client ?? createSupabaseAdminClient()
  const { data: lead } = await db
    .from('leads').select(CAMPOS_LEAD).eq('id', leadId).eq('organizacao_id', org).maybeSingle()
  if (!lead) return null

  let empresa: EmpresaRow | null = null
  let contato: ContatoRow | null = null
  if (lead.empresa_id) {
    empresa = (await db.from('empresas').select('*')
      .eq('id', lead.empresa_id).eq('organizacao_id', org).maybeSingle()).data as EmpresaRow | null
  }
  if (lead.contato_id) {
    contato = (await db.from('contatos').select('*')
      .eq('id', lead.contato_id).eq('organizacao_id', org).maybeSingle()).data as ContatoRow | null
  }
  return {
    empresa: montarEmpresaView(lead as LeadCompat, empresa),
    contato: montarContatoView(lead as LeadCompat, contato),
  }
}

// Empresa (entidade) por id — para telas futuras de Empresa/Decisores.
export async function buscarEmpresa(
  org: string,
  empresaId: string,
  client?: SupabaseClient,
): Promise<EmpresaView | null> {
  const db = client ?? createSupabaseAdminClient()
  const { data } = await db.from('empresas').select('*')
    .eq('id', empresaId).eq('organizacao_id', org).maybeSingle()
  if (!data) return null
  // Sem lead no contexto: a própria entidade é a fonte (montarEmpresaView(null, row)).
  return montarEmpresaView(null, data as EmpresaRow)
}

// TODOS os contatos/decisores de uma empresa (relacionamento — só a entidade tem).
// Ignora arquivados por padrão (histórico preservado, some da lista ativa).
export async function listarContatosDaEmpresa(
  org: string,
  empresaId: string,
  opts: { incluirArquivados?: boolean } = {},
  client?: SupabaseClient,
): Promise<ContatoView[]> {
  const db = client ?? createSupabaseAdminClient()
  let q = db.from('contatos').select('*')
    .eq('organizacao_id', org).eq('empresa_id', empresaId)
  if (!opts.incluirArquivados) q = q.eq('arquivado', false)
  const { data } = await q.order('criado_em', { ascending: true })
  return (data ?? []).map((row) => montarContatoView(null, row as ContatoRow))
}
