// Saúde do cron de follow-up (sprint item 2.5).
//
// Grava o timestamp da última execução BEM-SUCEDIDA do follow-up (por org) e,
// num healthcheck independente, alerta o Chico por e-mail se passou do limite de
// horas sem rodar — sinal de cron parado/quebrado. Tudo best-effort: nenhuma
// falha aqui pode derrubar a cadência.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type { EmailProvider } from './email/provider'
import { log } from './logger'

// Limite padrão (h) sem execução antes de alertar. Um pouco acima de 24h para
// não disparar por atraso normal de um cron diário. Configurável por org
// (configuracoes_motor.followup_alerta_horas) ou por env.
function limiteHorasPadrao(): number {
  const n = Number(process.env.FOLLOWUP_ALERTA_HORAS)
  return Number.isFinite(n) && n > 0 ? n : 26
}

// Destinatário do alerta: ALERT_EMAIL, senão a conta remetente (GMAIL_USER).
function destinoAlerta(): string | null {
  return process.env.ALERT_EMAIL || process.env.GMAIL_USER || null
}

// Marca uma execução bem-sucedida do follow-up. UPDATE (não upsert): se a org
// não tem linha em configuracoes_motor, simplesmente não rastreia — o
// healthcheck ignora orgs sem timestamp, então não gera falso alarme.
export async function marcarExecucaoFollowup(organizacaoId: string): Promise<void> {
  try {
    const db = createSupabaseAdminClient()
    await db
      .from('configuracoes_motor')
      .update({ followup_ultima_execucao: new Date().toISOString() })
      .eq('organizacao_id', organizacaoId)
  } catch (e) {
    log.aviso('Não consegui marcar execução do follow-up (telemetria).', {
      organizacaoId,
      erro: e instanceof Error ? e.message : String(e),
    })
  }
}

// Verifica staleness e alerta (deduplicado). Retorna true se enviou alerta.
export async function verificarSaudeFollowup(
  organizacaoId: string,
  email: EmailProvider,
): Promise<boolean> {
  try {
    const db = createSupabaseAdminClient()
    const { data } = await db
      .from('configuracoes_motor')
      .select('followup_ultima_execucao, followup_ultimo_alerta, followup_alerta_horas')
      .eq('organizacao_id', organizacaoId)
      .maybeSingle()

    // Sem linha ou nunca executou: não alerta (org nova/sem histórico).
    if (!data || !data.followup_ultima_execucao) return false

    const limiteH = Number.isFinite(data.followup_alerta_horas) && data.followup_alerta_horas > 0
      ? data.followup_alerta_horas
      : limiteHorasPadrao()
    const limiteMs = limiteH * 3600_000
    const agora = Date.now()
    const desde = agora - new Date(data.followup_ultima_execucao).getTime()
    if (desde <= limiteMs) return false // saudável

    // Dedup: não re-alerta dentro da mesma janela de limite.
    if (data.followup_ultimo_alerta && agora - new Date(data.followup_ultimo_alerta).getTime() <= limiteMs) {
      return false
    }

    const destino = destinoAlerta()
    if (!destino) {
      log.aviso('Follow-up parado, mas sem ALERT_EMAIL/GMAIL_USER para alertar.', { organizacaoId })
      return false
    }

    const horas = Math.floor(desde / 3600_000)
    const assunto = '⚠️ ProspectOS: cron de follow-up parado'
    const corpo =
      `O follow-up automático não roda há ~${horas}h (limite: ${limiteH}h).\n\n` +
      `Organização: ${organizacaoId}\n` +
      `Última execução: ${data.followup_ultima_execucao}\n\n` +
      `Verifique o cron do Vercel (/api/engine/follow-up) e os logs da função.`
    await email.enviar(destino, assunto, corpo)

    await db
      .from('configuracoes_motor')
      .update({ followup_ultimo_alerta: new Date().toISOString() })
      .eq('organizacao_id', organizacaoId)

    log.aviso('Alerta de cron parado enviado', { organizacaoId, horas, destino })
    return true
  } catch (e) {
    log.aviso('Healthcheck do follow-up falhou.', {
      organizacaoId,
      erro: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
