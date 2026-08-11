import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Camada de acesso a `oportunidades`, SEMPRE escopada por organização. Usa o
// client admin (service_role, que BYPASSA RLS) — por isso todo caminho filtra e
// grava organizacao_id EXPLICITAMENTE. É o que garante o isolamento entre
// tenants neste caminho (a RLS da migration 0022 é o backstop). Ver o teste de
// isolamento em __tests__/multitenant.test.ts.

const STATUS = ['aberta', 'ganha', 'perdida'] as const
export type StatusOportunidade = (typeof STATUS)[number]

const COLS =
  'id, titulo, valor, moeda, probabilidade, status, origem, motivo_perda, ' +
  'responsavel_id, previsao_fechamento, fechada_em, lead_id, empresa_id, contato_id, ' +
  'servico_id, pipeline_id, estagio_id, criado_em, atualizado_em'

export interface NovaOportunidade {
  titulo: string
  valor?: number | null
  moeda?: string | null
  probabilidade?: number | null
  status?: StatusOportunidade
  origem?: string | null
  responsavel_id?: string | null
  previsao_fechamento?: string | null
  lead_id?: string | null
  empresa_id?: string | null
  contato_id?: string | null
  servico_id?: string | null
  pipeline_id?: string | null
  estagio_id?: string | null
}

export function statusValido(s: unknown): s is StatusOportunidade {
  return typeof s === 'string' && (STATUS as readonly string[]).includes(s)
}

// Lista as oportunidades da org (mais recentes primeiro), opcionalmente por status.
export async function listarOportunidades(
  admin: SupabaseClient,
  org: string,
  filtros: { status?: string } = {},
) {
  let q = admin
    .from('oportunidades')
    .select(`${COLS}, empresas(nome)`)
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(300)
  if (filtros.status && statusValido(filtros.status)) q = q.eq('status', filtros.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

// Cria uma oportunidade na org. `fechada_em` é carimbado se já nascer fechada.
export async function criarOportunidade(admin: SupabaseClient, org: string, dados: NovaOportunidade) {
  const status: StatusOportunidade = statusValido(dados.status) ? dados.status : 'aberta'
  const { data, error } = await admin
    .from('oportunidades')
    .insert({
      organizacao_id: org,
      titulo: dados.titulo,
      valor: dados.valor ?? null,
      moeda: dados.moeda?.trim() || 'BRL',
      probabilidade: dados.probabilidade ?? null,
      status,
      origem: dados.origem ?? 'manual',
      responsavel_id: dados.responsavel_id ?? null,
      previsao_fechamento: dados.previsao_fechamento || null,
      fechada_em: status === 'aberta' ? null : new Date().toISOString(),
      lead_id: dados.lead_id ?? null,
      empresa_id: dados.empresa_id ?? null,
      contato_id: dados.contato_id ?? null,
      servico_id: dados.servico_id ?? null,
      pipeline_id: dados.pipeline_id ?? null,
      estagio_id: dados.estagio_id ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Atualiza campos de uma oportunidade (id + org). Ao mudar o status, sincroniza
// `fechada_em` (carimba ao fechar, limpa ao reabrir). `motivo_perda` só faz
// sentido em 'perdida'.
export async function atualizarOportunidade(
  admin: SupabaseClient,
  org: string,
  id: string,
  b: Record<string, unknown>,
) {
  const patch: Record<string, unknown> = {}
  if (typeof b.titulo === 'string' && b.titulo.trim()) patch.titulo = b.titulo.trim()
  if ('valor' in b) patch.valor = typeof b.valor === 'number' && Number.isFinite(b.valor) ? b.valor : null
  if ('probabilidade' in b) {
    const p = Number(b.probabilidade)
    patch.probabilidade = Number.isFinite(p) && p >= 0 && p <= 100 ? p : null
  }
  if ('previsao_fechamento' in b) patch.previsao_fechamento = b.previsao_fechamento || null
  if ('responsavel_id' in b) patch.responsavel_id = b.responsavel_id || null
  if ('estagio_id' in b) patch.estagio_id = b.estagio_id || null
  if ('pipeline_id' in b) patch.pipeline_id = b.pipeline_id || null
  if (statusValido(b.status)) {
    patch.status = b.status
    patch.fechada_em = b.status === 'aberta' ? null : new Date().toISOString()
    patch.motivo_perda = b.status === 'perdida' ? (typeof b.motivo_perda === 'string' ? b.motivo_perda : null) : null
  }
  if (Object.keys(patch).length === 0) throw new Error('Nada para atualizar')

  const { error } = await admin
    .from('oportunidades')
    .update(patch)
    .eq('id', id)
    .eq('organizacao_id', org)
  if (error) throw new Error(error.message)
}
