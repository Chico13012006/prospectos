// FLUXO 2 — DETECTAR RESPOSTA
// Lê a caixa do Gmail. Quando um lead responde DE VERDADE:
//  - ignora auto-respostas (férias, fora do escritório, devolvido/bounce)
//  - casa a mensagem ao lead por e-mail EXATO ou por DOMÍNIO (encaminhamento)
//  - PAUSA a cadência do lead (sai da esteira de follow-up)
//  - enfileira o direcionamento ao closer (Fluxo 3)
import { OWNER_ENGINE } from '../config'
import { log } from '../logger'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import { calcularScore, horasEntre } from '../scoring'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'
import type { Queue } from '../queue'
import type { MensagemRecebida, Lead } from '../types'

// Heurística de auto-resposta: além da dica do provedor (msg.automatica),
// reconhece os padrões clássicos de férias/ausência/devolução.
const PADROES_AUTO = [
  'fora do escrit', 'out of office', 'automatic reply', 'auto-reply', 'autoreply',
  'resposta autom', 'de férias', 'em férias', 'estou ausente', 'ausência do escrit',
  'delivery status notification', 'mail delivery', 'returned mail', 'undeliverable',
  'não foi possível entregar', 'devolvido', 'mailer-daemon', 'postmaster',
]

export function ehAutoResposta(msg: MensagemRecebida): boolean {
  if (msg.automatica) return true
  const alvo = `${msg.assunto}\n${msg.corpo}\n${msg.de}`.toLowerCase()
  return PADROES_AUTO.some((p) => alvo.includes(p))
}

// Prefixo-marcador da nota de sugestão (item 7). O LeadPanel reconhece este
// início para destacar a interação como "Contato alternativo sugerido".
export const MARCADOR_CONTATO_ALT = 'Contato alternativo sugerido (ausência):'

// Contato alternativo extraído de um auto-reply de férias/ausência.
export interface ContatoAlternativoExtraido {
  nome: string
  email: string
}

export interface DetectarRespostaOpts {
  // Extrator de contato alternativo (item 7). Injetado nos pontos de produção
  // (usa IA); ausente nos testes/ensaio, quando a extração é simplesmente pulada.
  extrairContatos?: (corpo: string) => Promise<ContatoAlternativoExtraido[]>
}

export async function detectarResposta(
  store: Store,
  email: EmailProvider,
  fila: Queue,
  opts: DetectarRespostaOpts = {},
): Promise<{ respostas: number; ignoradas: number; contatosAlternativos: number }> {
  const mensagens = await email.lerCaixaEntrada()
  if (mensagens.length === 0) {
    log.info('Caixa de entrada: nenhuma mensagem nova.')
    return { respostas: 0, ignoradas: 0, contatosAlternativos: 0 }
  }

  let respostas = 0
  let ignoradas = 0
  let contatosAlternativos = 0

  for (const msg of mensagens) {
    // 1) Auto-resposta nunca é tratada como resposta real. Mas, em vez de só
    // ignorar (item 7), se for um auto-reply de ausência com contato alternativo
    // no corpo, registra uma SUGESTÃO no lead para o comercial revisar.
    if (ehAutoResposta(msg)) {
      const sugeriu = await tratarAutoResposta(store, msg, opts)
      if (sugeriu) contatosAlternativos++
      else log.aviso('Ignorado (auto-resposta).', { de: msg.de, assunto: msg.assunto })
      ignoradas++
      continue
    }

    // 2) Casar com um lead: primeiro pelo e-mail exato; senão pelo domínio.
    const lead = await casarLead(store, msg.de)
    if (!lead) {
      log.aviso('Resposta não casa com nenhum lead do motor. Ignorada.', { de: msg.de })
      ignoradas++
      continue
    }

    // 3) Idempotência: se já saiu da esteira (já respondeu antes), não repetir.
    if (!ESTAGIOS_EM_CADENCIA.includes(lead.estagio as never)) {
      log.info('Lead já havia respondido/saído da esteira. Sem nova ação.', {
        leadId: lead.id,
        estagio: lead.estagio,
      })
      ignoradas++
      continue
    }

    // 4) Resposta real → PAUSAR a cadência na hora e registrar.
    // Score dinâmico (item 2.8): respondeu + bônus por velocidade (tempo entre
    // o último contato enviado e esta resposta).
    const horas = horasEntre(lead.ultimo_contato, msg.em)
    await store.atualizarLead(lead.id, {
      estagio: 'interessado',
      proxima_acao: 'aguardando_closer',
      proxima_acao_data: null,
      score: calcularScore({ respondeu: true, horasAteResposta: horas }),
    })
    await store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'resposta',
      canal: 'email',
      descricao: msg.corpo.slice(0, 2000),
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
    })
    log.ok('RESPOSTA detectada — cadência pausada. Encaminhando ao closer.', {
      leadId: lead.id,
      empresa: lead.empresa,
    })
    respostas++

    // 5) Enfileirar o Fluxo 3 (direcionar ao closer).
    fila.enfileirar('direcionar_closer', { leadId: lead.id, textoResposta: msg.corpo })
  }

  return { respostas, ignoradas, contatosAlternativos }
}

// Casa uma mensagem a um lead do motor: e-mail EXATO primeiro, senão pelo
// DOMÍNIO (encaminhamento). Só retorna leads owner='engine'.
async function casarLead(store: Store, de: string): Promise<Lead | null> {
  let lead = await store.buscarLeadPorEmail(de)
  if (!lead) {
    const dominio = de.split('@')[1] ?? ''
    lead = await store.buscarLeadPorDominio(dominio)
    if (lead) {
      log.info('Casado por DOMÍNIO (encaminhamento).', {
        de,
        empresa: lead.empresa,
        dominio: dominioDoLead(lead),
      })
    }
  }
  if (!lead || lead.owner !== OWNER_ENGINE) return null
  return lead
}

// Item 7: trata um auto-reply de ausência. Se houver extrator injetado, casa o
// lead e tenta extrair contato(s) alternativo(s) do corpo; achando algum,
// registra uma nota de SUGESTÃO (não auto-cadastra — revisão humana na v1).
// Retorna true se registrou uma sugestão. Nunca lança (bônus, não pode derrubar
// a detecção de resposta).
async function tratarAutoResposta(
  store: Store,
  msg: MensagemRecebida,
  opts: DetectarRespostaOpts,
): Promise<boolean> {
  if (!opts.extrairContatos) return false
  try {
    const lead = await casarLead(store, msg.de)
    if (!lead) return false
    const contatos = await opts.extrairContatos(msg.corpo)
    if (contatos.length === 0) return false
    const lista = contatos.map((c) => `${c.nome} <${c.email}>`).join('; ')
    await store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `${MARCADOR_CONTATO_ALT} ${lista}. Confirme antes de cadastrar como contato do lead.`,
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
    })
    log.ok('Auto-resposta com contato alternativo — sugestão registrada.', {
      leadId: lead.id,
      empresa: lead.empresa,
      contatos: contatos.length,
    })
    return true
  } catch (e) {
    log.aviso('Falha ao extrair contato alternativo do auto-reply.', {
      de: msg.de,
      erro: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}
