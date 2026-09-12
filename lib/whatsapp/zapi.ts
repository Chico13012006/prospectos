import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { telefoneParaEnvio } from './outbound'

// Adapter Z-API — camada de TRANSPORTE para envio de texto individual.
//
// Coexiste com a integração Meta (lib/whatsapp/outbound.ts): nada daqui
// substitui, chama ou altera o caminho da Meta. Nesta rodada o adapter só
// envia — NÃO grava em whatsapp_mensagens/interacoes, NÃO atualiza o lead.
// Persistência é a próxima microentrega.
//
// Segurança: credenciais vivem só em process.env no servidor. Nunca aparecem
// em retorno, log ou mensagem de erro; a resposta bruta da Z-API também não é
// devolvida — só os identificadores úteis.

const ZAPI_BASE = 'https://api.z-api.io'

export interface ConfigZapi {
  instanceId: string
  token: string
  clientToken: string
}

// Aceita qualquer mapa de strings (process.env ou um objeto de teste).
export type EnvZapi = Record<string, string | undefined>

export function lerConfigZapi(env: EnvZapi = process.env): ConfigZapi | null {
  const instanceId = env.ZAPI_INSTANCE_ID?.trim()
  const token = env.ZAPI_TOKEN?.trim()
  const clientToken = env.ZAPI_CLIENT_TOKEN?.trim()
  if (!instanceId || !token || !clientToken) return null
  return { instanceId, token, clientToken }
}

export type CodigoErroZapi =
  | 'config_ausente'    // faltam ZAPI_INSTANCE_ID / ZAPI_TOKEN / ZAPI_CLIENT_TOKEN
  | 'falha_rede'        // fetch lançou (DNS, timeout, conexão)
  | 'erro_provider'     // Z-API respondeu não-2xx
  | 'resposta_invalida' // 2xx, mas corpo não é JSON/objeto reconhecível

// Só os identificadores que a Z-API costuma devolver — cada um opcional, porque
// nem sempre vêm todos juntos.
export interface IdsZapi {
  messageId?: string
  zaapId?: string
  id?: string
}

export type ResultadoZapi =
  | ({ ok: true } & IdsZapi)
  | { ok: false; codigo: CodigoErroZapi; mensagem: string; status?: number }

export interface DepsZapi {
  fetch?: typeof fetch
  env?: EnvZapi
}

function extrairIds(corpo: unknown): IdsZapi {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const ids: IdsZapi = {}
  if (typeof o.messageId === 'string' && o.messageId) ids.messageId = o.messageId
  if (typeof o.zaapId === 'string' && o.zaapId) ids.zaapId = o.zaapId
  if (typeof o.id === 'string' && o.id) ids.id = o.id
  return ids
}

// Mensagem de erro do provider sem vazar nada: só o campo `message`/`error`
// textual, truncado. O corpo inteiro nunca é repassado.
function resumoErroProvider(corpo: unknown, status: number): string {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const texto = [o.message, o.error, o.value].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return texto ? `Z-API recusou o envio (HTTP ${status}): ${texto.slice(0, 200)}` : `Z-API recusou o envio (HTTP ${status}).`
}

/**
 * Envia UMA mensagem de texto pela Z-API.
 *
 * `phone` deve chegar já em E.164 sem "+" (ex.: 5511999998888) — quem resolve
 * telefone de lead é `enviarTextoZapiParaLead`, abaixo.
 */
export async function sendText(
  entrada: { phone: string; message: string },
  deps: DepsZapi = {},
): Promise<ResultadoZapi> {
  const cfg = lerConfigZapi(deps.env ?? process.env)
  if (!cfg) {
    return {
      ok: false,
      codigo: 'config_ausente',
      mensagem: 'Z-API não configurada: defina ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN.',
    }
  }

  const url = `${ZAPI_BASE}/instances/${encodeURIComponent(cfg.instanceId)}/token/${encodeURIComponent(cfg.token)}/send-text`
  const doFetch = deps.fetch ?? fetch

  let resposta: Response
  try {
    resposta = await doFetch(url, {
      method: 'POST',
      headers: {
        'Client-Token': cfg.clientToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone: entrada.phone, message: entrada.message }),
    })
  } catch (e) {
    return {
      ok: false,
      codigo: 'falha_rede',
      mensagem: `Falha de rede ao chamar a Z-API: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const corpo: unknown = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'whatsapp.zapi',
      msg: 'Z-API respondeu erro.', status: resposta.status,
    }))
    return { ok: false, codigo: 'erro_provider', status: resposta.status, mensagem: resumoErroProvider(corpo, resposta.status) }
  }

  if (!corpo || typeof corpo !== 'object') {
    return { ok: false, codigo: 'resposta_invalida', status: resposta.status, mensagem: 'Z-API respondeu 2xx sem corpo JSON reconhecível.' }
  }

  const ids = extrairIds(corpo)
  if (!ids.messageId && !ids.zaapId && !ids.id) {
    return { ok: false, codigo: 'resposta_invalida', status: resposta.status, mensagem: 'Z-API respondeu 2xx sem nenhum identificador de mensagem.' }
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(), nivel: 'info', escopo: 'whatsapp.zapi',
    msg: 'Mensagem enviada pela Z-API.', ...ids,
  }))
  return { ok: true, ...ids }
}

// --- Envio para LEAD ---------------------------------------------------------

export type CodigoErroEnvioZapi = CodigoErroZapi | 'texto_vazio' | 'lead_nao_encontrado' | 'sem_telefone'

export type ResultadoEnvioZapi =
  | ({ ok: true; provider: 'zapi'; telefone: string } & IdsZapi)
  | { ok: false; codigo: CodigoErroEnvioZapi; mensagem: string; status?: number }

/**
 * Resolve o lead na organização da SESSÃO, normaliza o telefone e envia.
 *
 * `organizacaoId` vem sempre do chamador (rota → resolverAcesso), nunca do
 * browser. O lead é lido com filtro explícito de organização (service_role
 * ignora RLS) — id de outra org devolve 'lead_nao_encontrado', sem revelar nada.
 *
 * Telefone: `leads.contato_telefone`, normalizado por `telefoneParaEnvio`
 * (mesmo helper do outbound Meta): só dígitos, com DDI 55, no formato que a
 * Z-API espera. Sem telefone reconhecível → 'sem_telefone'.
 *
 * NÃO persiste nada. Só transporte.
 */
export async function enviarTextoZapiParaLead(
  admin: SupabaseClient,
  entrada: { leadId: string; message: string; organizacaoId: string },
  deps: DepsZapi = {},
): Promise<ResultadoEnvioZapi> {
  const message = entrada.message?.trim()
  if (!message) return { ok: false, codigo: 'texto_vazio', mensagem: 'A mensagem está vazia.' }

  const { data: lead, error } = await admin
    .from('leads')
    .select('id, contato_telefone')
    .eq('id', entrada.leadId)
    .eq('organizacao_id', entrada.organizacaoId)
    .maybeSingle()
  if (error) throw error
  if (!lead) return { ok: false, codigo: 'lead_nao_encontrado', mensagem: 'Lead não encontrado nesta organização.' }

  const telefone = telefoneParaEnvio(lead.contato_telefone as string | null)
  if (!telefone) {
    return { ok: false, codigo: 'sem_telefone', mensagem: 'O lead não tem telefone em formato utilizável para WhatsApp.' }
  }

  const r = await sendText({ phone: telefone, message }, deps)
  if (!r.ok) return r
  const { ok: _ok, ...ids } = r
  return { ok: true, provider: 'zapi', telefone, ...ids }
}
