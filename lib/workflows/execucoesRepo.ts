import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Leitura read-only das execuções de workflow para a aba Execuções (Automação).
// SEMPRE escopado por organização (service_role bypassa RLS → filtra org
// explicitamente; a RLS da 0008 é o backstop). NÃO toca o motor (lib/engine)
// nem o WorkflowStore — é só uma projeção de leitura, como os repositories de
// campanhas/oportunidades. Junta o nome do workflow e a empresa do lead.

const STATUS = ['em_andamento', 'aguardando', 'concluido', 'erro', 'cancelado'] as const
export type StatusExecucao = (typeof STATUS)[number]
export function statusExecucaoValido(s: unknown): s is StatusExecucao {
  return typeof s === 'string' && (STATUS as readonly string[]).includes(s)
}

export interface ExecucaoResumo {
  id: string
  status: string
  passo_atual: number
  proxima_verificacao_em: string | null
  iniciado_em: string
  atualizado_em: string
  workflow_id: string
  workflow_nome: string | null
  lead_id: string | null
  lead_empresa: string | null
}

// Última linha por execução, mais recentes primeiro. `limite` protege a tela.
export async function listarExecucoes(
  admin: SupabaseClient,
  org: string,
  filtros: { status?: string; limite?: number } = {},
): Promise<ExecucaoResumo[]> {
  let q = admin
    .from('workflow_execucoes')
    .select('id, status, passo_atual, proxima_verificacao_em, iniciado_em, atualizado_em, workflow_id, lead_id, workflows(nome), leads(empresa)')
    .eq('organizacao_id', org)
    .order('atualizado_em', { ascending: false })
    .limit(Math.min(filtros.limite ?? 100, 200))
  if (statusExecucaoValido(filtros.status)) q = q.eq('status', filtros.status)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  // PostgREST devolve o join como objeto OU array de 1 — normaliza para escalar.
  const um = <T>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    status: r.status as string,
    passo_atual: (r.passo_atual as number) ?? 0,
    proxima_verificacao_em: (r.proxima_verificacao_em as string) ?? null,
    iniciado_em: r.iniciado_em as string,
    atualizado_em: r.atualizado_em as string,
    workflow_id: r.workflow_id as string,
    workflow_nome: um(r.workflows as { nome: string | null })?.nome ?? null,
    lead_id: (r.lead_id as string) ?? null,
    lead_empresa: um(r.leads as { empresa: string | null })?.empresa ?? null,
  }))
}
