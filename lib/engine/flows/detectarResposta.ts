// FLUXO 2 — DETECTAR RESPOSTA
// Lê a caixa do Gmail. Quando um lead responde DE VERDADE:
//  - ignora auto-respostas (férias, fora do escritório, devolvido/bounce)
//  - casa a mensagem ao lead por e-mail EXATO ou por DOMÍNIO (encaminhamento)
//  - PAUSA a cadência do lead (sai da esteira de follow-up)
//  - enfileira o direcionamento ao closer (Fluxo 3)
import { OWNER_ENGINE } from '../config'
import { log } from '../logger'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'
import type { Queue } from '../queue'
import type { MensagemRecebida } from '../types'

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

export async function detectarResposta(
  store: Store,
  email: EmailProvider,
  fila: Queue,
): Promise<{ respostas: number; ignoradas: number }> {
  const mensagens = await email.lerCaixaEntrada()
  if (mensagens.length === 0) {
    log.info('Caixa de entrada: nenhuma mensagem nova.')
    return { respostas: 0, ignoradas: 0 }
  }

  let respostas = 0
  let ignoradas = 0

  for (const msg of mensagens) {
    // 1) Auto-resposta nunca é tratada como resposta real.
    if (ehAutoResposta(msg)) {
      log.aviso('Ignorado (auto-resposta).', { de: msg.de, assunto: msg.assunto })
      ignoradas++
      continue
    }

    // 2) Casar com um lead: primeiro pelo e-mail exato; senão pelo domínio.
    let lead = await store.buscarLeadPorEmail(msg.de)
    if (!lead) {
      const dominio = msg.de.split('@')[1] ?? ''
      lead = await store.buscarLeadPorDominio(dominio)
      if (lead) {
        log.info('Resposta casada por DOMÍNIO (encaminhamento).', {
          de: msg.de,
          empresa: lead.empresa,
          dominio: dominioDoLead(lead),
        })
      }
    }
    if (!lead) {
      log.aviso('Resposta não casa com nenhum lead do motor. Ignorada.', { de: msg.de })
      ignoradas++
      continue
    }
    if (lead.owner !== OWNER_ENGINE) {
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
    await store.atualizarLead(lead.id, {
      estagio: 'interessado',
      proxima_acao: 'aguardando_closer',
      proxima_acao_data: null,
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

  return { respostas, ignoradas }
}
