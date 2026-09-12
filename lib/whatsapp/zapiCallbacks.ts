import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validarSegredoWebhook } from './zapiInbound'

// Callbacks de ENTREGA e de STATUS da Z-API — só metadata sobre mensagens que
// já existem em `whatsapp_mensagens`. Nunca cria mensagem, nunca resolve lead,
// nunca infere organização: o vínculo é exclusivamente pelo
// `whatsapp_message_id`, que é único.
//
// Formatos REAIS (developer.z-api.io, seções "Ao enviar" e "Ao atualizar
// status da mensagem"):
//
//   DeliveryCallback
//   { phone, zaapId, messageId, instanceId, momment, type: "DeliveryCallback",
//     error? }                       ← `error` só quando falhou; não há `status`
//
//   MessageStatusCallback
//   { instanceId, status, ids: [messageId, …], momment, phoneDevice, phone,
//     type: "MessageStatusCallback", isGroup }
//   status ∈ SENT | RECEIVED | READ | READ_BY_ME | PLAYED — SEM ordem documentada
//
// Tudo é gravado no `payload` jsonb já existente, preservando o que estava lá
// (origem, provider, zaapId, messageId…). Sem migration.

// --- Guarda das rotas --------------------------------------------------------
// As duas rotas de callback compartilham exatamente a mesma entrada.
export type EnvWebhook = Record<string, string | undefined>

export function lerConfigWebhookZapi(env: EnvWebhook = process.env):
  | { ok: true; secret: string; instanceId: string }
  | { ok: false; faltando: 'ZAPI_WEBHOOK_SECRET' | 'ZAPI_INSTANCE_ID' } {
  const secret = env.ZAPI_WEBHOOK_SECRET?.trim()
  if (!secret) return { ok: false, faltando: 'ZAPI_WEBHOOK_SECRET' }
  const instanceId = env.ZAPI_INSTANCE_ID?.trim()
  if (!instanceId) return { ok: false, faltando: 'ZAPI_INSTANCE_ID' }
  return { ok: true, secret, instanceId }
}

export { validarSegredoWebhook }

// --- Utilidades --------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// `momment` em MILISSEGUNDOS. Ausente/inválido → agora, com momment null.
function mommentParaIso(v: unknown): { em: string; momment: number | null } {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (Number.isFinite(n) && n > 0) return { em: new Date(n).toISOString(), momment: n }
  return { em: new Date().toISOString(), momment: null }
}

type Payload = Record<string, unknown>
function comoPayload(v: unknown): Payload {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : {}
}

// --- DeliveryCallback --------------------------------------------------------

export interface EventoDelivery {
  instanceId: string
  messageId: string
  zaapId: string | null
  em: string
  momment: number | null
  erro: string | null // presença de `error` no callback = falha de entrega
}

export type LeituraDelivery =
  | { tipo: 'evento'; evento: EventoDelivery }
  | { tipo: 'ignorar'; motivo: 'tipo_nao_suportado' | 'instancia_desconhecida' }
  | { tipo: 'invalido'; motivo: string }

export function interpretarDeliveryCallback(payload: unknown, instanceIdEsperado: string): LeituraDelivery {
  if (!payload || typeof payload !== 'object') return { tipo: 'invalido', motivo: 'payload não é objeto' }
  const p = payload as Record<string, unknown>
  if (p.type !== 'DeliveryCallback') return { tipo: 'ignorar', motivo: 'tipo_nao_suportado' }
  const instanceId = str(p.instanceId)
  if (!instanceId || instanceId !== instanceIdEsperado) return { tipo: 'ignorar', motivo: 'instancia_desconhecida' }
  const messageId = str(p.messageId)
  if (!messageId) return { tipo: 'invalido', motivo: 'messageId ausente' }
  const { em, momment } = mommentParaIso(p.momment)
  return {
    tipo: 'evento',
    evento: { instanceId, messageId, zaapId: str(p.zaapId), em, momment, erro: str(p.error) },
  }
}

// Registro no payload: `delivery` = último evento conhecido. Mais novo vence;
// igual (mesmo instante e mesmo resultado) é duplicata; mais antigo é ignorado.
export function aplicarDelivery(payloadAtual: unknown, ev: EventoDelivery): { payload: Payload; alterado: boolean } {
  const base = comoPayload(payloadAtual)
  const atual = comoPayload(base.delivery)
  const registro = {
    status: ev.erro ? 'erro' : 'entregue',
    recebidoEm: ev.em,
    momment: ev.momment,
    ...(ev.zaapId ? { zaapId: ev.zaapId } : {}),
    ...(ev.erro ? { erro: ev.erro } : {}),
  }
  if (typeof atual.recebidoEm === 'string') {
    if (atual.recebidoEm === ev.em && (atual.erro ?? null) === (ev.erro ?? null)) return { payload: base, alterado: false }
    if (ev.em < atual.recebidoEm) return { payload: base, alterado: false }
  }
  return { payload: { ...base, delivery: registro }, alterado: true }
}

// --- MessageStatusCallback ---------------------------------------------------

export const STATUS_ZAPI = ['SENT', 'RECEIVED', 'READ', 'READ_BY_ME', 'PLAYED'] as const
export type StatusZapi = (typeof STATUS_ZAPI)[number]
const CONJUNTO_STATUS = new Set<string>(STATUS_ZAPI)

export interface EventoStatus {
  instanceId: string
  ids: string[]
  status: StatusZapi
  em: string
  momment: number | null
}

export type LeituraStatus =
  | { tipo: 'evento'; evento: EventoStatus }
  | { tipo: 'ignorar'; motivo: 'tipo_nao_suportado' | 'instancia_desconhecida' | 'grupo' | 'status_desconhecido' }
  | { tipo: 'invalido'; motivo: string }

export function interpretarMessageStatusCallback(payload: unknown, instanceIdEsperado: string): LeituraStatus {
  if (!payload || typeof payload !== 'object') return { tipo: 'invalido', motivo: 'payload não é objeto' }
  const p = payload as Record<string, unknown>
  if (p.type !== 'MessageStatusCallback') return { tipo: 'ignorar', motivo: 'tipo_nao_suportado' }
  const instanceId = str(p.instanceId)
  if (!instanceId || instanceId !== instanceIdEsperado) return { tipo: 'ignorar', motivo: 'instancia_desconhecida' }
  if (p.isGroup === true) return { tipo: 'ignorar', motivo: 'grupo' }

  const status = str(p.status)
  // Status fora da lista documentada: ignorar com 200 — não vamos inventar
  // enum, e um reenvio não mudaria nada.
  if (!status || !CONJUNTO_STATUS.has(status)) return { tipo: 'ignorar', motivo: 'status_desconhecido' }

  const ids = Array.isArray(p.ids) ? p.ids.map(str).filter((x): x is string => !!x) : []
  if (ids.length === 0) return { tipo: 'invalido', motivo: 'ids ausente ou vazio' }

  const { em, momment } = mommentParaIso(p.momment)
  return { tipo: 'evento', evento: { instanceId, ids, status: status as StatusZapi, em, momment } }
}

const LIMITE_HISTORICO = 20

// Registro no payload. Como a Z-API NÃO documenta ordem entre os status, a
// regra é por TEMPO do callback: `messageStatus` = evento mais recente (empate
// mantém o que já está); um status atrasado não rebaixa. Além disso,
// `statusHistorico` guarda os eventos distintos (status + instante), capado,
// para diagnóstico e para que um evento fora de ordem não se perca.
export function aplicarStatus(payloadAtual: unknown, ev: EventoStatus): { payload: Payload; alterado: boolean } {
  const base = comoPayload(payloadAtual)
  const historico = Array.isArray(base.statusHistorico)
    ? (base.statusHistorico as Array<{ status?: unknown; em?: unknown }>)
    : []
  const duplicado = historico.some((h) => h.status === ev.status && h.em === ev.em)
  if (duplicado) return { payload: base, alterado: false }

  const novoHistorico = [...historico, { status: ev.status, em: ev.em, momment: ev.momment }].slice(-LIMITE_HISTORICO)
  const atual = comoPayload(base.messageStatus)
  const maisNovo = typeof atual.atualizadoEm !== 'string' || ev.em > atual.atualizadoEm
  const messageStatus = maisNovo
    ? { status: ev.status, atualizadoEm: ev.em, momment: ev.momment }
    : atual
  return { payload: { ...base, messageStatus, statusHistorico: novoHistorico }, alterado: true }
}

// --- Persistência ------------------------------------------------------------

export type ResultadoRegistro = 'atualizada' | 'sem_alteracao' | 'orfa' | 'erro'

// Localiza SÓ pelo whatsapp_message_id (único). Sem filtro de organização de
// propósito: o callback não tem tenant e a linha pode estar sem vínculo; e
// aqui só se mexe em metadata do payload, nunca em lead_id/organizacao_id.
async function carregar(admin: SupabaseClient, messageId: string) {
  const { data, error } = await admin
    .from('whatsapp_mensagens')
    .select('id, payload')
    .eq('whatsapp_message_id', messageId)
    .maybeSingle()
  if (error) throw error
  return (data as { id: string; payload: unknown } | null) ?? null
}

async function salvar(admin: SupabaseClient, rowId: string, messageId: string, payload: Payload) {
  const { error } = await admin
    .from('whatsapp_mensagens')
    .update({ payload })
    .eq('id', rowId)
    .eq('whatsapp_message_id', messageId)
  if (error) throw error
}

async function aplicarEmMensagem(
  admin: SupabaseClient,
  messageId: string,
  aplicar: (payloadAtual: unknown) => { payload: Payload; alterado: boolean },
): Promise<ResultadoRegistro> {
  try {
    const linha = await carregar(admin, messageId)
    if (!linha) return 'orfa'
    const { payload, alterado } = aplicar(linha.payload)
    if (!alterado) return 'sem_alteracao'
    await salvar(admin, linha.id, messageId, payload)
    return 'atualizada'
  } catch (e) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi',
      msg: 'Falha ao registrar callback na mensagem.', messageId, erro: e instanceof Error ? e.message : String(e),
    }))
    return 'erro'
  }
}

export function registrarDelivery(admin: SupabaseClient, ev: EventoDelivery): Promise<ResultadoRegistro> {
  return aplicarEmMensagem(admin, ev.messageId, (p) => aplicarDelivery(p, ev))
}

// Um callback de status pode trazer VÁRIOS ids: cada um é tratado à parte.
export async function registrarStatus(admin: SupabaseClient, ev: EventoStatus): Promise<Record<string, ResultadoRegistro>> {
  const resultado: Record<string, ResultadoRegistro> = {}
  for (const id of ev.ids) {
    resultado[id] = await aplicarEmMensagem(admin, id, (p) => aplicarStatus(p, ev))
  }
  return resultado
}
