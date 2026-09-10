import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Parsing + persistência das mensagens inbound do WhatsApp Cloud API.
//
// O webhook (/api/webhooks/whatsapp) só chama isto; toda a lógica fica aqui
// para poder ser testada sem subir rota. Sem vínculo com lead nesta rodada —
// `organizacao_id` da tabela fica NULL e será preenchido depois.

// Formato do webhook da Meta (só os campos que usamos). Ver
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
interface PayloadMeta {
  object?: string
  entry?: Array<{
    id?: string
    changes?: Array<{
      field?: string
      value?: ValorMudanca
    }>
  }>
}

interface ValorMudanca {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
  messages?: MensagemMeta[]
  // Eventos de status (entrega/leitura) vêm aqui — ignorados nesta rodada.
  statuses?: unknown[]
}

interface MensagemMeta {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
  }
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
  [k: string]: unknown
}

export interface MensagemInbound {
  whatsappMessageId: string
  remetente: string
  remetenteNome: string | null
  tipo: string
  conteudo: string | null
  mensagemEm: string // ISO 8601
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  payloadBruto: Record<string, unknown> // o `value` da mudança
}

// Texto legível da mensagem, quando o tipo tem algum. Para tipos sem texto
// (sticker, location, contacts, reaction…) devolve null — o payload cru guarda
// o resto.
function extrairConteudo(msg: MensagemMeta): string | null {
  const candidatos = [
    msg.text?.body,
    msg.button?.text,
    msg.interactive?.button_reply?.title,
    msg.interactive?.list_reply?.title,
    msg.image?.caption,
    msg.video?.caption,
    msg.document?.caption,
    msg.document?.filename,
  ]
  for (const c of candidatos) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return null
}

// epoch (segundos, string) -> ISO. Cai para "agora" se vier ausente/inválido.
function timestampParaIso(bruto: string | undefined): string {
  const seg = Number(bruto)
  if (Number.isFinite(seg) && seg > 0) return new Date(seg * 1000).toISOString()
  return new Date().toISOString()
}

/**
 * Extrai as mensagens REAIS de um payload do webhook. Eventos que não são
 * mensagem (status de entrega/leitura, notificações de conta) resultam em lista
 * vazia — sem erro. Mensagem sem `id` ou sem `from` é descartada (não dá para
 * deduplicar nem saber de quem é).
 */
export function extrairMensagensInbound(payload: unknown): MensagemInbound[] {
  const p = payload as PayloadMeta
  if (!p || typeof p !== 'object' || !Array.isArray(p.entry)) return []

  const resultado: MensagemInbound[] = []
  for (const entry of p.entry) {
    for (const mudanca of entry.changes ?? []) {
      const valor = mudanca.value
      if (!valor || !Array.isArray(valor.messages) || valor.messages.length === 0) continue

      const nomePorWaId = new Map<string, string>()
      for (const contato of valor.contacts ?? []) {
        const nome = contato.profile?.name?.trim()
        if (contato.wa_id && nome) nomePorWaId.set(contato.wa_id, nome)
      }

      for (const msg of valor.messages) {
        if (!msg.id || !msg.from) continue
        resultado.push({
          whatsappMessageId: msg.id,
          remetente: msg.from,
          remetenteNome: nomePorWaId.get(msg.from) ?? null,
          tipo: typeof msg.type === 'string' && msg.type ? msg.type : 'unknown',
          conteudo: extrairConteudo(msg),
          mensagemEm: timestampParaIso(msg.timestamp),
          phoneNumberId: valor.metadata?.phone_number_id ?? null,
          displayPhoneNumber: valor.metadata?.display_phone_number ?? null,
          payloadBruto: valor as unknown as Record<string, unknown>,
        })
      }
    }
  }
  return resultado
}

export interface ResultadoPersistencia {
  recebidas: number
  novas: number
  duplicadas: number
  erros: number
}

/**
 * Grava cada mensagem, ignorando as que já existem (idempotência por
 * `whatsapp_message_id`). Nunca lança: um erro de banco é contado e registrado,
 * mas não pode virar resposta não-200 para a Meta (evita reenvio em loop).
 */
export async function persistirMensagensInbound(
  admin: SupabaseClient,
  mensagens: MensagemInbound[],
): Promise<ResultadoPersistencia> {
  const resultado: ResultadoPersistencia = {
    recebidas: mensagens.length, novas: 0, duplicadas: 0, erros: 0,
  }

  for (const m of mensagens) {
    try {
      const { data, error } = await admin
        .from('whatsapp_mensagens')
        .upsert(
          {
            whatsapp_message_id: m.whatsappMessageId,
            direcao: 'inbound',
            remetente: m.remetente,
            remetente_nome: m.remetenteNome,
            tipo: m.tipo,
            conteudo: m.conteudo,
            mensagem_em: m.mensagemEm,
            phone_number_id: m.phoneNumberId,
            display_phone_number: m.displayPhoneNumber,
            payload: m.payloadBruto,
          },
          { onConflict: 'whatsapp_message_id', ignoreDuplicates: true },
        )
        .select('id')

      if (error) {
        resultado.erros += 1
        console.error(JSON.stringify({
          ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
          msg: 'Falha ao gravar mensagem inbound.',
          whatsappMessageId: m.whatsappMessageId, erro: error.message,
        }))
        continue
      }
      // upsert com ignoreDuplicates: linha retornada = inserção nova; vazio = já existia.
      if ((data?.length ?? 0) > 0) resultado.novas += 1
      else resultado.duplicadas += 1
    } catch (e) {
      resultado.erros += 1
      console.error(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
        msg: 'Exceção ao gravar mensagem inbound.',
        whatsappMessageId: m.whatsappMessageId,
        erro: e instanceof Error ? e.message : String(e),
      }))
    }
  }
  return resultado
}
