import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone, variantesTelefoneBr } from './telefone'

// Envio OUTBOUND de mensagem de texto pelo WhatsApp Cloud API + registro em
// `whatsapp_mensagens`. Fonte única do WhatsApp continua sendo essa tabela:
// NADA é gravado em `interacoes`.
//
// Esta rodada cobre SÓ texto livre dentro da janela de atendimento de 24h
// (mensagem de serviço). Template aprovado (HSM), mídia e status de entrega
// ficam para depois — fora da janela a função recusa e diz o porquê.
//
// Liberação de envio real: WHATSAPP_MODO_ENSAIO=false. NÃO usa o MODO_ENSAIO
// global de propósito — ver `whatsappModoEnsaio()` abaixo.
//
// Segurança: `organizacaoId` NUNCA vem do browser. Quem chama resolve a
// organização pela sessão (lib/rbac/servidor) e passa aqui; o lead é relido
// filtrando por essa organização, então um id de outra org simplesmente não é
// encontrado.

const JANELA_HORAS = 24
const VERSAO_API_PADRAO = 'v21.0'

/**
 * Trava de ensaio EXCLUSIVA do WhatsApp outbound.
 *
 * Deliberadamente separada de `MODO_ENSAIO` (lib/engine/config), que é global e
 * governa o motor de e-mail: ligar o WhatsApp real não pode, como efeito
 * colateral, liberar disparo de e-mail. As duas travas são independentes e cada
 * canal exige a sua.
 *
 * Ausente ou qualquer valor != 'false' → true (seguro por padrão). Só a string
 * exata 'false' libera envio real.
 */
export function whatsappModoEnsaio(): boolean {
  return (process.env.WHATSAPP_MODO_ENSAIO ?? 'true') !== 'false'
}

export type ResultadoEnvio =
  | { ok: true; simulado: true; motivo: 'whatsapp_modo_ensaio'; telefone: string }
  | { ok: true; simulado: false; whatsappMessageId: string; mensagemId: string | null }
  | { ok: false; codigo: CodigoErroEnvio; mensagem: string }

export type CodigoErroEnvio =
  | 'config_ausente'      // faltam credenciais da Meta no ambiente
  | 'lead_nao_encontrado' // id inexistente OU de outra organização
  | 'sem_telefone'        // lead sem telefone utilizável
  | 'fora_da_janela'      // nenhuma inbound nas últimas 24h -> exige HSM
  | 'texto_vazio'
  | 'falha_meta'          // a Meta recusou o envio
  | 'falha_registro'      // enviou, mas não conseguiu gravar

interface CredenciaisMeta {
  accessToken: string
  phoneNumberId: string
  versaoApi: string
}

// Credenciais vivem SÓ no servidor. Nenhuma delas é NEXT_PUBLIC_* — o browser
// nunca deve ver o access token.
function lerCredenciais(): CredenciaisMeta | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!accessToken || !phoneNumberId) return null
  return {
    accessToken,
    phoneNumberId,
    versaoApi: process.env.WHATSAPP_API_VERSION || VERSAO_API_PADRAO,
  }
}

// Número no formato que a Meta espera: E.164 sem '+', com DDI. Reusa as
// variantes de lib/whatsapp/telefone.ts, que devolve sempre o par
// [com DDI, sem DDI] em alguma ordem — a com DDI é a MAIS LONGA.
//
// Escolher por comprimento, não por prefixo "55": o DDD 55 (Santa Maria/RS)
// faz um número local como "5599887766" começar com 55 sem ter DDI algum.
export function telefoneParaEnvio(bruto: string | null | undefined): string | null {
  const variantes = variantesTelefoneBr(normalizarTelefone(bruto))
  if (variantes.length === 0) return null
  return variantes.reduce((maior, v) => (v.length > maior.length ? v : maior))
}

/**
 * Há mensagem inbound deste lead dentro da janela de 24h?
 *
 * A janela de atendimento do WhatsApp abre a cada mensagem que o CLIENTE envia
 * e dura 24h; dentro dela pode-se mandar texto livre. Fora dela, a Meta só
 * aceita template aprovado (HSM) — que esta rodada não implementa.
 *
 * Usa `mensagem_em` (timestamp da Meta), que é a cronologia real da conversa.
 */
export async function dentroDaJanela24h(
  admin: SupabaseClient,
  leadId: string,
  organizacaoId: string,
  agora: Date = new Date(),
): Promise<{ dentro: boolean; ultimaInboundEm: string | null }> {
  const limite = new Date(agora.getTime() - JANELA_HORAS * 3600_000).toISOString()
  const { data, error } = await admin
    .from('whatsapp_mensagens')
    .select('mensagem_em')
    .eq('lead_id', leadId)
    .eq('organizacao_id', organizacaoId) // service_role ignora RLS: filtrar aqui
    .eq('direcao', 'inbound')
    .order('mensagem_em', { ascending: false })
    .limit(1)
  if (error) throw error

  const ultima = (data?.[0]?.mensagem_em as string | undefined) ?? null
  return { dentro: !!ultima && ultima >= limite, ultimaInboundEm: ultima }
}

/**
 * Envia uma mensagem de texto e registra o envio.
 *
 * `organizacaoId` é sempre resolvido pelo chamador a partir da SESSÃO — nunca
 * do payload do cliente. O lead é buscado com filtro explícito de organização
 * (service_role ignora RLS), então lead de outra org devolve 'lead_nao_encontrado'.
 *
 * WHATSAPP_MODO_ENSAIO=true (padrão) NÃO chama a Meta e NÃO grava nada — só
 * devolve o que faria. Trava própria deste canal: não depende do MODO_ENSAIO
 * global nem o afeta.
 */
export async function enviarTextoWhatsapp(
  admin: SupabaseClient,
  entrada: { leadId: string; texto: string; organizacaoId: string },
): Promise<ResultadoEnvio> {
  const texto = entrada.texto?.trim()
  if (!texto) {
    return { ok: false, codigo: 'texto_vazio', mensagem: 'A mensagem está vazia.' }
  }

  const credenciais = lerCredenciais()
  if (!credenciais) {
    return {
      ok: false,
      codigo: 'config_ausente',
      mensagem: 'Envio indisponível: WHATSAPP_ACCESS_TOKEN e/ou WHATSAPP_PHONE_NUMBER_ID não configurados.',
    }
  }

  // ISOLAMENTO: o lead só é encontrado se pertencer à organização da sessão.
  const { data: lead, error: erroLead } = await admin
    .from('leads')
    .select('id, contato_telefone, contato_nome')
    .eq('id', entrada.leadId)
    .eq('organizacao_id', entrada.organizacaoId)
    .maybeSingle()
  if (erroLead) throw erroLead
  if (!lead) {
    return {
      ok: false,
      codigo: 'lead_nao_encontrado',
      mensagem: 'Lead não encontrado nesta organização.',
    }
  }

  const telefone = telefoneParaEnvio(lead.contato_telefone as string | null)
  if (!telefone) {
    return {
      ok: false,
      codigo: 'sem_telefone',
      mensagem: 'O lead não tem telefone em formato utilizável para WhatsApp.',
    }
  }

  // JANELA DE 24H: sem inbound recente, texto livre é recusado pela Meta.
  // Barramos ANTES de chamar a API para não queimar tentativa nem gerar erro lá.
  const janela = await dentroDaJanela24h(admin, lead.id as string, entrada.organizacaoId)
  if (!janela.dentro) {
    return {
      ok: false,
      codigo: 'fora_da_janela',
      mensagem: janela.ultimaInboundEm
        ? `Fora da janela de ${JANELA_HORAS}h (última mensagem recebida em ${janela.ultimaInboundEm}). Será preciso um template aprovado.`
        : `Sem mensagem recebida deste lead — a janela de ${JANELA_HORAS}h nunca abriu. Será preciso um template aprovado.`,
    }
  }

  // TRAVA DE ENSAIO DO WHATSAPP (independente do MODO_ENSAIO global do motor de
  // e-mail). Em ensaio não chama a Meta e não grava nada — o envio real exige
  // WHATSAPP_MODO_ENSAIO=false explícito, e só libera este canal.
  if (whatsappModoEnsaio()) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'whatsapp.outbound',
      msg: 'WHATSAPP_MODO_ENSAIO: envio simulado, nada foi enviado nem gravado.',
      leadId: lead.id, organizacaoId: entrada.organizacaoId, caracteres: texto.length,
    }))
    return { ok: true, simulado: true, motivo: 'whatsapp_modo_ensaio', telefone }
  }

  // --- Chamada real à Cloud API -------------------------------------------
  const url = `https://graph.facebook.com/${credenciais.versaoApi}/${credenciais.phoneNumberId}/messages`
  let respostaMeta: unknown
  let statusHttp = 0
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credenciais.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: telefone,
        type: 'text',
        text: { preview_url: false, body: texto },
      }),
    })
    statusHttp = r.status
    respostaMeta = await r.json().catch(() => null)
    if (!r.ok) {
      const detalhe = (respostaMeta as { error?: { message?: string } } | null)?.error?.message
      console.error(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'erro', escopo: 'whatsapp.outbound',
        msg: 'Meta recusou o envio.', status: statusHttp, leadId: lead.id, detalhe,
      }))
      return {
        ok: false,
        codigo: 'falha_meta',
        mensagem: detalhe ? `Meta recusou o envio: ${detalhe}` : `Meta recusou o envio (HTTP ${statusHttp}).`,
      }
    }
  } catch (e) {
    return {
      ok: false,
      codigo: 'falha_meta',
      mensagem: `Falha de rede ao chamar a Meta: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  const whatsappMessageId =
    (respostaMeta as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ?? null
  if (!whatsappMessageId) {
    return {
      ok: false,
      codigo: 'falha_meta',
      mensagem: 'A Meta respondeu sem id de mensagem — envio não confirmado.',
    }
  }

  // --- Registro ------------------------------------------------------------
  // A tabela não tem coluna `destinatario`; `remetente` guarda SEMPRE o telefone
  // do CLIENTE (nos dois sentidos), que é o que agrupa a conversa e o que o
  // vínculo por telefone do inbound usa. `direcao` diz quem falou.
  const agora = new Date().toISOString()
  const { data: gravada, error: erroGravar } = await admin
    .from('whatsapp_mensagens')
    .insert({
      whatsapp_message_id: whatsappMessageId,
      direcao: 'outbound',
      lead_id: lead.id,
      organizacao_id: entrada.organizacaoId, // da sessão, nunca do cliente
      remetente: telefone,
      remetente_nome: (lead.contato_nome as string | null) ?? null,
      tipo: 'text',
      conteudo: texto,
      mensagem_em: agora,
      phone_number_id: credenciais.phoneNumberId,
      display_phone_number: null,
      // `payload` é NOT NULL. Guarda a resposta da Meta + o essencial do pedido.
      // NUNCA o access token.
      payload: { origem: 'prospectos.outbound', status_http: statusHttp, resposta: respostaMeta },
    })
    .select('id')
    .maybeSingle()

  if (erroGravar) {
    // A mensagem JÁ FOI ENVIADA. Não propaga como falha de envio: o usuário não
    // pode reenviar achando que falhou. Registra e devolve sucesso sem id local.
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'whatsapp.outbound',
      msg: 'Mensagem enviada, mas falhou ao gravar em whatsapp_mensagens.',
      whatsappMessageId, leadId: lead.id, erro: erroGravar.message,
    }))
    return { ok: true, simulado: false, whatsappMessageId, mensagemId: null }
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(), nivel: 'info', escopo: 'whatsapp.outbound',
    msg: 'Mensagem de WhatsApp enviada e registrada.',
    whatsappMessageId, leadId: lead.id, organizacaoId: entrada.organizacaoId,
  }))
  return {
    ok: true,
    simulado: false,
    whatsappMessageId,
    mensagemId: (gravada?.id as string | undefined) ?? null,
  }
}
