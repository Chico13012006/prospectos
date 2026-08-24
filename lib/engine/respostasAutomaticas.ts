import 'server-only'
import { send } from '@vercel/queue'
import type { SupabaseClient } from '@supabase/supabase-js'

export const TOPICO_MONITOR_RESPOSTAS = 'respostas-email-v1'
export const INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS = 120
export const JANELA_MONITOR_RESPOSTAS_DIAS = 30
const RETENCAO_MONITOR_RESPOSTAS_SEGUNDOS = 10 * 60

export interface MensagemMonitorRespostas {
  organizacaoId: string
  ciclo: number
}

type EnfileirarMonitor = (
  topico: string,
  mensagem: MensagemMonitorRespostas,
  opcoes: { delaySeconds: number; retentionSeconds: number; idempotencyKey: string },
) => Promise<unknown>

export class MensagemMonitorRespostasInvalida extends Error {}

export function validarMensagemMonitorRespostas(valor: unknown): MensagemMonitorRespostas {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new MensagemMonitorRespostasInvalida('Mensagem do monitor de respostas inválida.')
  }
  const mensagem = valor as Record<string, unknown>
  if (
    typeof mensagem.organizacaoId !== 'string'
    || !mensagem.organizacaoId.trim()
    || !Number.isInteger(mensagem.ciclo)
    || Number(mensagem.ciclo) < 0
  ) {
    throw new MensagemMonitorRespostasInvalida('Mensagem do monitor de respostas incompleta.')
  }
  return {
    organizacaoId: mensagem.organizacaoId,
    ciclo: Number(mensagem.ciclo),
  }
}

export function montarProximoMonitorRespostas(organizacaoId: string, agora: Date = new Date()) {
  if (!organizacaoId.trim()) throw new Error('Organização obrigatória para monitorar respostas.')
  const intervaloMs = INTERVALO_MONITOR_RESPOSTAS_SEGUNDOS * 1_000
  const ciclo = Math.floor(agora.getTime() / intervaloMs) + 1
  const agendadoEmMs = ciclo * intervaloMs
  return {
    mensagem: { organizacaoId, ciclo },
    agendadoPara: new Date(agendadoEmMs).toISOString(),
    delaySeconds: Math.max(0, Math.ceil((agendadoEmMs - agora.getTime()) / 1_000)),
    idempotencyKey: `respostas:${organizacaoId}:${ciclo}`,
  }
}

export async function agendarMonitorRespostas(
  organizacaoId: string,
  opcoes: { agora?: Date; enfileirar?: EnfileirarMonitor } = {},
) {
  const agenda = montarProximoMonitorRespostas(organizacaoId, opcoes.agora)
  await (opcoes.enfileirar ?? send)(
    TOPICO_MONITOR_RESPOSTAS,
    agenda.mensagem,
    {
      delaySeconds: agenda.delaySeconds,
      retentionSeconds: RETENCAO_MONITOR_RESPOSTAS_SEGUNDOS,
      idempotencyKey: agenda.idempotencyKey,
    },
  )
  return agenda
}

export async function haEnvioRecenteParaMonitorar(
  db: SupabaseClient,
  organizacaoId: string,
  agora: Date = new Date(),
): Promise<boolean> {
  const desde = new Date(
    agora.getTime() - JANELA_MONITOR_RESPOSTAS_DIAS * 24 * 60 * 60 * 1_000,
  ).toISOString()
  const { data, error } = await db
    .from('interacoes')
    .select('id')
    .eq('organizacao_id', organizacaoId)
    .eq('origem_acao', 'ia')
    .eq('canal', 'email')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return !!data
}
