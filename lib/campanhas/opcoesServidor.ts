import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { lerCredenciaisGmail } from '@/lib/engine/email/gmailProvider'

export interface RemetenteCampanha {
  conta: string
  email: string
}

export async function buscarRemetenteCampanha(
  admin: SupabaseClient,
  org: string,
): Promise<RemetenteCampanha | null> {
  const { data, error } = await admin
    .from('organizacoes')
    .select('configuracoes')
    .eq('id', org)
    .maybeSingle()
  if (error) throw error

  const config = parseWorkspaceConfig((data as { configuracoes?: unknown } | null)?.configuracoes)
  const conta = config.nomenclaturas?.email_conta_key?.trim() || 'followup'
  const credenciais = lerCredenciaisGmail(conta)
  return credenciais ? { conta, email: credenciais.user } : null
}

