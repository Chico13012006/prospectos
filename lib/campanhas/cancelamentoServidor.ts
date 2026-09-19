// Cancelamento de execuções de PROSPECÇÃO ao opt-out (item 5 desta entrega).
//
// Escopo deliberadamente estreito: cancela SÓ as workflow_execucoes ligadas a
// campanhas tipo='prospeccao' do lead. NÃO toca em execuções de renovação
// (nem de qualquer outro tipo) — o opt-out de um lead em renovação continua
// se comportando exatamente como antes desta entrega (gap conhecido, fora do
// escopo aqui; ver relatório da entrega). Isto evita alterar comportamento de
// Renovação/Laudos ao mesmo tempo em que fecha o gap para prospecção.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function cancelarExecucoesProspeccaoDoLead(
  admin: SupabaseClient,
  org: string,
  leadId: string,
): Promise<{ canceladas: number }> {
  const { data: campanhas, error: campanhasErro } = await admin
    .from('campanhas')
    .select('id')
    .eq('organizacao_id', org)
    .eq('tipo', 'prospeccao')
  if (campanhasErro) throw campanhasErro
  const campanhaIds = (campanhas ?? []).map((c) => c.id as string)
  if (!campanhaIds.length) return { canceladas: 0 }

  const { data, error } = await admin
    .from('workflow_execucoes')
    .update({ status: 'cancelado' })
    .eq('organizacao_id', org)
    .eq('lead_id', leadId)
    .in('campanha_id', campanhaIds)
    .in('status', ['em_andamento', 'aguardando'])
    .select('id')
  if (error) throw error
  return { canceladas: data?.length ?? 0 }
}
