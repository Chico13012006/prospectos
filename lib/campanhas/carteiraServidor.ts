import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function transferirLeadImportadoParaMotor(
  admin: SupabaseClient,
  org: string,
  leadId: string,
): Promise<boolean> {
  const { data, error } = await admin.from('leads')
    .update({ owner: 'engine' })
    .eq('organizacao_id', org)
    .eq('id', leadId)
    .eq('owner', 'n8n')
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

export async function restaurarLeadImportadoForaDoMotor(
  admin: SupabaseClient,
  org: string,
  leadId: string,
): Promise<void> {
  const { error } = await admin.from('leads').update({ owner: 'n8n' })
    .eq('organizacao_id', org).eq('id', leadId).eq('owner', 'engine')
  if (error) throw error
}
