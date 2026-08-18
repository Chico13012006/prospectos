import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Acesso a `campanhas`, SEMPRE escopado por organização (service_role bypassa
// RLS → filtra/grava organizacao_id explicitamente; RLS da 0023 é o backstop).
// Ver teste de isolamento em __tests__/multitenant.test.ts.

const STATUS = ['rascunho', 'ativa', 'pausada', 'concluida'] as const
export type StatusCampanha = (typeof STATUS)[number]
export function statusValido(s: unknown): s is StatusCampanha {
  return typeof s === 'string' && (STATUS as readonly string[]).includes(s)
}

// Transições válidas do ciclo de vida (rascunho→ativa→pausada⇄ativa→concluida).
const TRANSICOES: Record<StatusCampanha, StatusCampanha[]> = {
  rascunho: ['ativa'],
  ativa: ['pausada', 'concluida'],
  pausada: ['ativa', 'concluida'],
  concluida: [],
}
export function transicaoPermitida(de: StatusCampanha, para: StatusCampanha): boolean {
  return TRANSICOES[de]?.includes(para) ?? false
}

const COLS = 'id, nome, descricao, tipo, status, workflow_id, publico, meta_leads, dry_run, iniciada_em, concluida_em, criado_em, atualizado_em'

export interface NovaCampanha {
  nome: string
  descricao?: string | null
  tipo?: string | null
  workflow_id?: string | null
  publico?: Record<string, unknown> | null
  meta_leads?: number | null
  dry_run?: boolean
}

export async function listarCampanhas(admin: SupabaseClient, org: string, filtros: { status?: string } = {}) {
  let q = admin
    .from('campanhas')
    .select(COLS)
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(200)
  if (filtros.status && statusValido(filtros.status)) q = q.eq('status', filtros.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

// Uma campanha por id, escopada por org (para detalhe e reabertura no wizard).
// Devolve null se não existir na org (deep-link inválido / cross-tenant).
export async function buscarCampanha(admin: SupabaseClient, org: string, id: string) {
  const { data, error } = await admin
    .from('campanhas')
    .select(COLS)
    .eq('organizacao_id', org)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

export async function criarCampanha(admin: SupabaseClient, org: string, dados: NovaCampanha) {
  const { data, error } = await admin
    .from('campanhas')
    .insert({
      organizacao_id: org,
      nome: dados.nome,
      descricao: dados.descricao ?? null,
      tipo: dados.tipo ?? null,
      status: 'rascunho',
      workflow_id: dados.workflow_id ?? null,
      publico: dados.publico ?? {},
      meta_leads: dados.meta_leads ?? null,
      dry_run: dados.dry_run ?? true,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Atualiza campos e/ou transiciona o status (validando o ciclo de vida). Ao
// ativar pela 1ª vez carimba iniciada_em; ao concluir carimba concluida_em.
export async function atualizarCampanha(admin: SupabaseClient, org: string, id: string, b: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  if (typeof b.nome === 'string' && b.nome.trim()) patch.nome = b.nome.trim()
  if ('descricao' in b) patch.descricao = typeof b.descricao === 'string' ? b.descricao : null
  if ('workflow_id' in b) patch.workflow_id = b.workflow_id || null
  if ('meta_leads' in b) {
    patch.meta_leads = b.meta_leads == null || b.meta_leads === ''
      ? null
      : Number.isFinite(Number(b.meta_leads)) ? Number(b.meta_leads) : null
  }
  if (b.publico && typeof b.publico === 'object') patch.publico = b.publico
  if (typeof b.dry_run === 'boolean') patch.dry_run = b.dry_run

  if (statusValido(b.status)) {
    const { data: atual, error: e0 } = await admin
      .from('campanhas').select('status, iniciada_em').eq('id', id).eq('organizacao_id', org).maybeSingle()
    if (e0) throw new Error(e0.message)
    if (!atual) throw new Error('Campanha não encontrada')
    const de = atual.status as StatusCampanha
    if (de !== b.status) {
      if (!transicaoPermitida(de, b.status)) throw new Error(`Transição inválida: ${de} → ${b.status}`)
      patch.status = b.status
      if (b.status === 'ativa' && !atual.iniciada_em) patch.iniciada_em = new Date().toISOString()
      if (b.status === 'concluida') patch.concluida_em = new Date().toISOString()
    }
  }
  if (Object.keys(patch).length === 0) throw new Error('Nada para atualizar')

  const { error } = await admin.from('campanhas').update(patch).eq('id', id).eq('organizacao_id', org)
  if (error) throw new Error(error.message)
}
