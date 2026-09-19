import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig, type WorkspaceConfig } from '@/lib/config/workspaceConfig'
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

// Status do remetente DEDICADO da organização (Configurações > E-mail de
// prospecção). Ao contrário de `buscarRemetenteCampanha`, NUNCA cai no
// fallback 'followup'/conta global — ausência de `email_conta_key` é
// reportada como "não configurado", não mascarada pela conta padrão da
// instância. É o que decide o bloqueio de ativação/envio real de prospecção
// (item 3 da entrega) e o que a tela de Configurações exibe como status.
export interface StatusRemetenteProspeccao {
  contaKey: string | null
  email: string | null
  conectado: boolean
}

export function statusRemetenteProspeccaoDeConfig(config: WorkspaceConfig): StatusRemetenteProspeccao {
  const contaKey = config.nomenclaturas?.email_conta_key?.trim() || null
  if (!contaKey) return { contaKey: null, email: null, conectado: false }
  const credenciais = lerCredenciaisGmail(contaKey)
  return { contaKey, email: credenciais?.user ?? null, conectado: !!credenciais }
}

export async function statusRemetenteProspeccao(
  admin: SupabaseClient,
  org: string,
): Promise<StatusRemetenteProspeccao> {
  const { data, error } = await admin
    .from('organizacoes')
    .select('configuracoes')
    .eq('id', org)
    .maybeSingle()
  if (error) throw error
  return statusRemetenteProspeccaoDeConfig(
    parseWorkspaceConfig((data as { configuracoes?: unknown } | null)?.configuracoes),
  )
}

export async function exigirEnvioRealCampanhaDisponivel(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
): Promise<RemetenteCampanha> {
  if (engineConfig.modoEnsaio) {
    throw new Error('Envio real indisponível: desative o MODO_ENSAIO no ambiente do Vercel.')
  }
  // Prospecção exige remetente EXPLICITAMENTE configurado nesta organização —
  // nunca o fallback silencioso 'followup'/conta global de outra organização
  // (item 3 da entrega "E-mail de prospecção"). Renovação e demais tipos
  // preservam o comportamento anterior (fallback permitido). Busca só a coluna
  // `tipo` (independente de `buscarCampanha`) para não acoplar este gate ao
  // formato completo da campanha.
  const { data, error } = await admin
    .from('campanhas')
    .select('tipo')
    .eq('id', campanhaId)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (error) throw error
  const tipoCampanha = (data as { tipo?: string | null } | null)?.tipo ?? null
  if (tipoCampanha === 'prospeccao') {
    const status = await statusRemetenteProspeccao(admin, org)
    if (!status.conectado) {
      throw new Error('Configure um remetente em Configurações antes de iniciar a campanha.')
    }
    return { conta: status.contaKey as string, email: status.email as string }
  }
  const remetente = await buscarRemetenteCampanha(admin, org)
  if (!remetente) {
    throw new Error('Envio real indisponível: configure a conta Gmail deste workspace.')
  }
  return remetente
}
