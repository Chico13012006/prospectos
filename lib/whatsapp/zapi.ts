import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { telefoneParaEnvio } from './outbound'

// Adapter Z-API — camada de TRANSPORTE para envio de texto individual.
//
// Coexiste com a integração Meta (lib/whatsapp/outbound.ts): nada daqui
// substitui, chama ou altera o caminho da Meta.
//
// Fluxo de envio para lead: status da instância → send-text → registro em
// `whatsapp_mensagens` (mesma tabela e convenções do outbound Meta). Não grava
// em `interacoes` nem atualiza o lead.
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

// Uma chamada autenticada à Z-API. Header Client-Token nunca é logado.
async function chamarZapi(
  cfg: ConfigZapi,
  caminho: 'status' | 'send-text',
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
  doFetch: typeof fetch,
): Promise<{ resposta: Response } | { falha: string }> {
  const url = `${ZAPI_BASE}/instances/${encodeURIComponent(cfg.instanceId)}/token/${encodeURIComponent(cfg.token)}/${caminho}`
  try {
    const resposta = await doFetch(url, {
      method: init.method,
      headers: {
        'Client-Token': cfg.clientToken,
        ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
    })
    return { resposta }
  } catch (e) {
    return { falha: e instanceof Error ? e.message : String(e) }
  }
}

export interface StatusZapi {
  connected: boolean
  smartphoneConnected: boolean
  erro?: string
}

export type ResultadoStatusZapi =
  | ({ ok: true } & StatusZapi)
  | { ok: false; codigo: CodigoErroZapi; mensagem: string; status?: number }

/**
 * Saúde da instância: GET /status. `connected` = instância ligada à Z-API;
 * `smartphoneConnected` = celular pareado e online. Só com os DOIS true a
 * mensagem chega — por isso o envio para lead consulta isto antes.
 */
export async function getStatus(deps: DepsZapi = {}): Promise<ResultadoStatusZapi> {
  const cfg = lerConfigZapi(deps.env ?? process.env)
  if (!cfg) {
    return { ok: false, codigo: 'config_ausente', mensagem: 'Z-API não configurada: defina ZAPI_INSTANCE_ID, ZAPI_TOKEN e ZAPI_CLIENT_TOKEN.' }
  }
  const r = await chamarZapi(cfg, 'status', { method: 'GET' }, deps.fetch ?? fetch)
  if ('falha' in r) return { ok: false, codigo: 'falha_rede', mensagem: `Falha de rede ao consultar status da Z-API: ${r.falha}` }

  const corpo: unknown = await r.resposta.json().catch(() => null)
  if (!r.resposta.ok) {
    return { ok: false, codigo: 'erro_provider', status: r.resposta.status, mensagem: resumoErroProvider(corpo, r.resposta.status) }
  }
  const o = (corpo && typeof corpo === 'object' ? corpo : null) as Record<string, unknown> | null
  if (!o || typeof o.connected !== 'boolean') {
    return { ok: false, codigo: 'resposta_invalida', status: r.resposta.status, mensagem: 'Z-API respondeu /status sem o campo "connected".' }
  }
  return {
    ok: true,
    connected: o.connected,
    // Ausente = não afirmou que está conectado: tratamos como false.
    smartphoneConnected: o.smartphoneConnected === true,
    ...(typeof o.error === 'string' && o.error ? { erro: o.error } : {}),
  }
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

  const r = await chamarZapi(cfg, 'send-text', { method: 'POST', body: { phone: entrada.phone, message: entrada.message } }, deps.fetch ?? fetch)
  if ('falha' in r) return { ok: false, codigo: 'falha_rede', mensagem: `Falha de rede ao chamar a Z-API: ${r.falha}` }
  const { resposta } = r

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

export type CodigoErroEnvioZapi =
  | CodigoErroZapi
  | 'texto_vazio'
  | 'lead_nao_encontrado'
  | 'sem_telefone'
  | 'zapi_status_falhou'   // não foi possível consultar /status
  | 'zapi_desconectada'    // instância ou celular fora do ar — send-text NÃO é chamado

export type ResultadoEnvioZapi =
  | ({ ok: true; provider: 'zapi'; telefone: string; registrada: boolean; mensagemId: string | null } & IdsZapi)
  | { ok: false; codigo: CodigoErroEnvioZapi; mensagem: string; status?: number }

/**
 * Resolve o lead na organização da SESSÃO, normaliza o telefone, confere a
 * saúde da instância, envia e registra.
 *
 * `organizacaoId` vem sempre do chamador (rota → resolverAcesso), nunca do
 * browser. O lead é lido com filtro explícito de organização (service_role
 * ignora RLS) — id de outra org devolve 'lead_nao_encontrado', sem revelar nada.
 *
 * Telefone: `leads.contato_telefone`, normalizado por `telefoneParaEnvio`
 * (mesmo helper do outbound Meta).
 *
 * Ordem: status → send-text → registro. Só grava depois de a Z-API aceitar.
 */
export async function enviarTextoZapiParaLead(
  admin: SupabaseClient,
  entrada: { leadId: string; message: string; organizacaoId: string },
  deps: DepsZapi = {},
): Promise<ResultadoEnvioZapi> {
  const message = entrada.message?.trim()
  if (!message) return { ok: false, codigo: 'texto_vazio', mensagem: 'A mensagem está vazia.' }

  // ISOLAMENTO: só encontra o lead se ele for da organização da sessão.
  const { data: lead, error } = await admin
    .from('leads')
    .select('id, contato_telefone, contato_nome')
    .eq('id', entrada.leadId)
    .eq('organizacao_id', entrada.organizacaoId)
    .maybeSingle()
  if (error) throw error
  if (!lead) return { ok: false, codigo: 'lead_nao_encontrado', mensagem: 'Lead não encontrado nesta organização.' }

  const telefone = telefoneParaEnvio(lead.contato_telefone as string | null)
  if (!telefone) {
    return { ok: false, codigo: 'sem_telefone', mensagem: 'O lead não tem telefone em formato utilizável para WhatsApp.' }
  }

  // SAÚDE DA INSTÂNCIA antes de gastar o envio. Uma instância desconectada
  // devolve 200 + ids no send-text e a mensagem simplesmente não chega —
  // foi exatamente o que aconteceu no primeiro teste real.
  const status = await getStatus(deps)
  if (!status.ok) {
    return { ok: false, codigo: 'zapi_status_falhou', status: status.status, mensagem: `Não foi possível verificar a instância Z-API: ${status.mensagem}` }
  }
  if (status.connected !== true || status.smartphoneConnected === false) {
    const motivo = status.connected !== true ? 'instância desconectada' : 'celular desconectado'
    return {
      ok: false,
      codigo: 'zapi_desconectada',
      mensagem: `Z-API indisponível para envio (${motivo}${status.erro ? `: ${status.erro}` : ''}). Reconecte a instância e tente de novo.`,
    }
  }

  const envio = await sendText({ phone: telefone, message }, deps)
  if (!envio.ok) return envio
  const { ok: _ok, ...ids } = envio

  // --- Registro (mesmas convenções do outbound Meta) ------------------------
  // `remetente` = telefone do CLIENTE nos dois sentidos (agrupa a conversa e é
  // o que o vínculo por telefone do inbound usa); `direcao` diz quem falou.
  // `whatsapp_message_id` recebe o messageId da Z-API (é o id do WhatsApp);
  // sem ele, cai para zaapId/id — o índice único exige algo aqui.
  // Colunas específicas da Meta (phone_number_id, display_phone_number) ficam
  // nulas. `provider` e `zaapId` vão no `payload` jsonb, que já é o slot de
  // metadata do provedor — sem migration.
  const whatsappMessageId = ids.messageId ?? ids.zaapId ?? ids.id ?? ''
  const { data: gravada, error: erroGravar } = await admin
    .from('whatsapp_mensagens')
    // upsert + ignoreDuplicates (padrão do inbound): um reenvio acidental do
    // MESMO registro não duplica — o índice único em whatsapp_message_id segura.
    .upsert(
      {
        whatsapp_message_id: whatsappMessageId,
        direcao: 'outbound',
        lead_id: lead.id,
        organizacao_id: entrada.organizacaoId, // da sessão, nunca do cliente
        remetente: telefone,
        remetente_nome: (lead.contato_nome as string | null) ?? null,
        tipo: 'text',
        conteudo: message,
        mensagem_em: new Date().toISOString(),
        phone_number_id: null,
        display_phone_number: null,
        payload: { origem: 'prospectos.outbound', provider: 'zapi', ...ids },
      },
      { onConflict: 'whatsapp_message_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (erroGravar) {
    // A mensagem JÁ FOI ACEITA pela Z-API. Não devolver erro: quem chamou
    // reenviaria em dobro. Registra, devolve sucesso com registrada=false —
    // e NÃO chama a Z-API de novo.
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'whatsapp.zapi',
      msg: 'Mensagem aceita pela Z-API, mas falhou ao gravar em whatsapp_mensagens.',
      whatsappMessageId, leadId: lead.id, erro: erroGravar.message,
    }))
    return { ok: true, provider: 'zapi', telefone, registrada: false, mensagemId: null, ...ids }
  }

  return {
    ok: true,
    provider: 'zapi',
    telefone,
    registrada: true,
    mensagemId: (gravada?.id as string | undefined) ?? null,
    ...ids,
  }
}
