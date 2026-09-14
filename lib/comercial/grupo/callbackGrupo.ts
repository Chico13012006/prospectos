// Interpretação PURA do ReceivedCallback de GRUPO da Z-API (Fase 4).
//
// O inbound individual (lib/whatsapp/zapiInbound) continua ignorando grupos e
// gravando conversas de lead em whatsapp_mensagens. Mensagens de grupo NÃO são
// conversas de lead: passam por aqui, viram (no máximo) um comando auditado
// em comercial_grupo_comandos e nunca tocam whatsapp_mensagens.
//
// Formato do callback de grupo (docs Z-API, ReceivedCallback):
//   type: 'ReceivedCallback', isGroup: true,
//   phone: '<id do grupo>' (ex.: 120363019502650977-group),
//   participantPhone: '<telefone de quem escreveu>', senderName, chatName (nome do grupo),
//   messageId, momment (ms), fromMe, text: { message }.
// Só texto; fromMe (nossos próprios avisos/check-ins) é ignorado.
import { normalizarTelefone } from '@/lib/whatsapp/telefone'

interface CallbackGrupoZapi {
  type?: unknown
  instanceId?: unknown
  messageId?: unknown
  phone?: unknown
  participantPhone?: unknown
  fromMe?: unknown
  momment?: unknown
  chatName?: unknown
  senderName?: unknown
  isGroup?: unknown
  text?: { message?: unknown } | null
}

export interface EventoGrupo {
  grupoId: string
  providerMessageId: string
  remetente: string | null        // participantPhone, só dígitos (auditoria)
  remetenteNome: string | null
  grupoNome: string | null
  texto: string
  recebidoEm: string              // ISO (momment) ou agora
}

export type InterpretacaoGrupo =
  | { tipo: 'evento'; evento: EventoGrupo }
  | { tipo: 'ignorar'; motivo: 'nao_e_grupo' | 'tipo_nao_suportado' | 'instancia_desconhecida' | 'from_me' | 'sem_texto' }
  | { tipo: 'invalido'; motivo: string }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function interpretarCallbackGrupo(payload: unknown, instanceIdEsperado: string): InterpretacaoGrupo {
  if (!payload || typeof payload !== 'object') return { tipo: 'invalido', motivo: 'payload não é objeto' }
  const p = payload as CallbackGrupoZapi
  if (p.type !== 'ReceivedCallback') return { tipo: 'ignorar', motivo: 'tipo_nao_suportado' }
  const instanceId = str(p.instanceId)
  if (!instanceId || instanceId !== instanceIdEsperado) return { tipo: 'ignorar', motivo: 'instancia_desconhecida' }
  if (p.isGroup !== true) return { tipo: 'ignorar', motivo: 'nao_e_grupo' }
  if (p.fromMe === true) return { tipo: 'ignorar', motivo: 'from_me' }

  const grupoId = str(p.phone)
  if (!grupoId) return { tipo: 'invalido', motivo: 'phone (id do grupo) ausente' }
  const messageId = str(p.messageId)
  if (!messageId) return { tipo: 'invalido', motivo: 'messageId ausente' }
  const texto = str(p.text?.message)
  if (!texto) return { tipo: 'ignorar', motivo: 'sem_texto' }

  const n = typeof p.momment === 'number' ? p.momment : typeof p.momment === 'string' ? Number(p.momment) : NaN
  const recebidoEm = Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString()
  const remetenteBruto = str(p.participantPhone)

  return {
    tipo: 'evento',
    evento: {
      grupoId,
      providerMessageId: messageId,
      remetente: remetenteBruto ? normalizarTelefone(remetenteBruto) : null,
      remetenteNome: str(p.senderName),
      grupoNome: str(p.chatName),
      texto,
      recebidoEm,
    },
  }
}
