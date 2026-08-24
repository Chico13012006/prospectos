import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { engineConfig } from '@/lib/engine/config'
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

export async function exigirEnvioRealCampanhaDisponivel(
  admin: SupabaseClient,
  org: string,
): Promise<RemetenteCampanha> {
  if (engineConfig.modoEnsaio) {
    throw new Error('Envio real indisponível: desative o MODO_ENSAIO no ambiente do Vercel.')
  }
  const remetente = await buscarRemetenteCampanha(admin, org)
  if (!remetente) {
    throw new Error('Envio real indisponível: configure a conta Gmail deste workspace.')
  }
  return remetente
}
