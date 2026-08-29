// FLUXO 2 — DETECTAR RESPOSTA
// Lê a caixa do Gmail. Quando um lead responde DE VERDADE:
//  - ignora auto-respostas (férias, fora do escritório, devolvido/bounce)
//  - casa a mensagem ao lead por e-mail EXATO ou por DOMÍNIO (encaminhamento)
//  - PAUSA a cadência do lead (sai da esteira de follow-up)
//  - enfileira o direcionamento ao closer (Fluxo 3)
// Quando um BOUNCE SMTP é detectado (migration 0027):
//  - marca o lead como bounced=true
//  - cancela todas as workflow_execucoes ativas do lead
import { OWNER_ENGINE } from '../config'
import { log } from '../logger'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import { calcularScore, horasEntre } from '../scoring'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'
import type { Queue } from '../queue'
import type { ContextoCampanhaResposta, MensagemRecebida, Lead, UsuarioBasico } from '../types'

// Heurística de auto-resposta: além da dica do provedor (msg.automatica),
// reconhece os padrões clássicos de férias/ausência/devolução.
const PADROES_AUTO = [
  'fora do escrit', 'out of office', 'automatic reply', 'auto-reply', 'autoreply',
  'resposta autom', 'de férias', 'em férias', 'estou ausente', 'ausência do escrit',
  'delivery status notification', 'mail delivery', 'returned mail', 'undeliverable',
  'não foi possível entregar', 'devolvido', 'mailer-daemon', 'postmaster',
]

// Padrões que indicam especificamente BOUNCE SMTP (falha de entrega permanente).
// Subconjunto de PADROES_AUTO: toda bounce é auto-resposta, mas não o contrário.
// Remetente mailer-daemon/postmaster OU assunto com padrões canônicos de bounce.
const PADROES_BOUNCE_REMETENTE = ['mailer-daemon@', 'postmaster@']
const PADROES_BOUNCE_ASSUNTO = [
  'undeliverable', 'delivery status notification', 'mail delivery failed',
  'returned mail', 'delivery failure', 'não foi possível entregar',
  'failure notice', 'message not delivered',
]

export function ehAutoResposta(msg: MensagemRecebida): boolean {
  if (msg.automatica) return true
  const alvo = `${msg.assunto}\n${msg.corpo}\n${msg.de}`.toLowerCase()
  return PADROES_AUTO.some((p) => alvo.includes(p))
}

// Bounce SMTP: falha permanente de entrega — o email não existe ou o servidor
// rejeitou definitivamente. Distingue de auto-reply de ausência (recuperável).
export function ehBounce(msg: MensagemRecebida): boolean {
  const de = msg.de.toLowerCase()
  if (PADROES_BOUNCE_REMETENTE.some((p) => de.includes(p))) return true
  const assunto = msg.assunto.toLowerCase()
  return PADROES_BOUNCE_ASSUNTO.some((p) => assunto.includes(p))
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
  // Orquestradores reais adiam o \Seen até a notificação ao responsável
  // terminar. Chamadas isoladas preservam o comportamento auto-contido.
  adiarConfirmacaoLeitura?: boolean
}

export async function detectarResposta(
  store: Store,
  email: EmailProvider,
  fila: Queue,
  opts: DetectarRespostaOpts = {},
): Promise<{ respostas: number; ignoradas: number; contatosAlternativos: number; bounces: number }> {
  const mensagens = await email.lerCaixaEntrada()
  if (mensagens.length === 0) {
    log.info('Caixa de entrada: nenhuma mensagem nova.')
    return { respostas: 0, ignoradas: 0, contatosAlternativos: 0, bounces: 0 }
  }

  let respostas = 0
  let ignoradas = 0
  let contatosAlternativos = 0
  let bounces = 0

  for (const msg of mensagens) {
    // 1) Auto-resposta: verifica se é bounce antes de tratar como férias/ausência.
    if (ehAutoResposta(msg)) {
      if (ehBounce(msg)) {
        // Bounce SMTP: marcar lead, cancelar cadência, registrar nota.
        const bouncou = await tratarBounce(store, msg)
        if (bouncou) bounces++
        else log.aviso('Bounce não casou com nenhum lead. Ignorado.', { de: msg.de })
        ignoradas++
        continue
      }
      // Auto-reply de ausência: tentar extrair contato alternativo.
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

    // 3) Resolve o contexto antes do gate de estágio. Campanhas de comunicado
    // podem enviar sem mover o lead para a cadência tradicional; ainda assim a
    // resposta precisa ser reconhecida e encaminhada ao responsável escolhido.
    let responsavelCampanha: UsuarioBasico | null = null
    let contextoCampanha: ContextoCampanhaResposta | null = null
    try {
      if (store.buscarContextoCampanhaAtiva) {
        contextoCampanha = await store.buscarContextoCampanhaAtiva(lead.id)
        responsavelCampanha = contextoCampanha?.responsavel ?? null
      } else {
        responsavelCampanha = store.buscarResponsavelCampanhaAtiva
          ? await store.buscarResponsavelCampanhaAtiva(lead.id)
          : null
      }
    } catch (e) {
      log.aviso('Não foi possível resolver o responsável da campanha; usando o responsável do lead.', {
        leadId: lead.id,
        erro: e instanceof Error ? e.message : String(e),
      })
    }

    // 4) Idempotência: uma tentativa anterior pode já ter persistido a resposta
    // e ainda estar aguardando a notificação ao closer. Fora da cadência, só
    // aceitamos um lead ligado a campanha e sem resposta já registrada.
    const retomandoEncaminhamento = lead.proxima_acao === 'aguardando_closer'
    const emCadencia = ESTAGIOS_EM_CADENCIA.includes(lead.estagio as never)
    const respostasNesteCiclo = contextoCampanha?.iniciadoEm
      ? await store.contarInteracoesDesde(lead.id, 'resposta', contextoCampanha.iniciadoEm)
      : await store.contarInteracoes(lead.id, 'resposta')
    const respostaCampanhaPendente = !emCadencia
      && !retomandoEncaminhamento
      && !!contextoCampanha
      && respostasNesteCiclo === 0
    if (!emCadencia && !retomandoEncaminhamento && !respostaCampanhaPendente) {
      log.info('Lead já havia respondido/saído da esteira. Sem nova ação.', {
        leadId: lead.id,
        estagio: lead.estagio,
      })
      ignoradas++
      continue
    }

    // 5) Resposta real → PAUSAR a cadência na hora e registrar.
    // Score dinâmico (item 2.8): respondeu + bônus por velocidade (tempo entre
    // o último contato enviado e esta resposta).
    if (!retomandoEncaminhamento) {
      // Registra antes de mudar o estágio: se a persistência falhar, a mensagem
      // continua não lida e uma nova tentativa não perde o conteúdo da resposta.
      await store.registrarInteracao({
        lead_id: lead.id,
        tipo: 'resposta',
        canal: 'email',
        descricao: msg.corpo.slice(0, 2000),
        origem_acao: 'ia',
        responsavel_id: lead.responsavel_id ?? null,
      })
      const horas = horasEntre(lead.ultimo_contato, msg.em)
      await store.atualizarLead(lead.id, {
        estagio: 'interessado',
        proxima_acao: 'aguardando_closer',
        proxima_acao_data: null,
        score: calcularScore({ respondeu: true, horasAteResposta: horas }),
      })
      respostas++
    } else {
      log.info('Retomando notificação pendente ao closer.', { leadId: lead.id })
    }
    // O estágio tira o lead da cadência legada; o cancelamento explícito faz o
    // mesmo para workflows persistentes. Também é repetido no retry, pois é
    // idempotente e pode ter sido o ponto da falha anterior.
    await store.cancelarExecucoesWorkflow(lead.id)
    log.ok('RESPOSTA detectada — cadência pausada. Encaminhando ao closer.', {
      leadId: lead.id,
      empresa: lead.empresa,
    })

    // 5) Enfileirar o Fluxo 3 (direcionar ao closer).
    fila.enfileirar('direcionar_closer', { leadId: lead.id, textoResposta: msg.corpo, responsavelCampanha, contextoCampanha })
  }

  // Só confirma a leitura depois que todas as alterações do lote terminaram.
  // Se qualquer persistência falhar, a mensagem continua não lida e a fila
  // durável poderá tentar novamente. A idempotência por estágio evita duplicar
  // uma resposta que já tenha sido registrada antes da falha.
  if (!opts.adiarConfirmacaoLeitura) await email.confirmarLeitura?.(mensagens)

  return { respostas, ignoradas, contatosAlternativos, bounces }
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

// Bounce SMTP: casa o lead pelo DESTINATÁRIO (campo "To" não disponível na
// mensagem recebida — casamos pelo endereço no corpo do bounce ou por domínio).
// Como o bounce vem do mailer-daemon, o campo `de` não é o lead — precisa
// extrair o email original do assunto/corpo.
// Estratégia pragmática: busca qualquer lead que tenha sido o DESTINATÁRIO;
// o bounce geralmente inclui o endereço original no corpo ou no assunto.
async function tratarBounce(store: Store, msg: MensagemRecebida): Promise<boolean> {
  // Extrai endereço de e-mail do corpo/assunto do bounce.
  const alvo = `${msg.assunto} ${msg.corpo}`
  const match = alvo.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i)
  if (!match) {
    log.aviso('Bounce sem e-mail identificável no corpo.', { de: msg.de, assunto: msg.assunto })
    return false
  }
  const emailOriginal = match[0].toLowerCase()
  const lead = await store.buscarLeadPorEmail(emailOriginal)
  if (!lead) {
    log.aviso('Bounce: e-mail não casa com nenhum lead.', { emailOriginal })
    return false
  }

  // Marca o lead como bounced e cancela as execuções ativas.
  await store.atualizarLead(lead.id, {
    bounced: true,
    bounced_em: new Date().toISOString(),
    proxima_acao: null,
    proxima_acao_data: null,
  })
  await store.cancelarExecucoesWorkflow(lead.id)
  await store.registrarInteracao({
    lead_id: lead.id,
    tipo: 'nota',
    canal: 'sistema',
    descricao: `Bounce SMTP detectado: e-mail devolvido pelo servidor. Lead marcado como bounced — removido da cadência automática. Assunto original: "${msg.assunto}"`,
    origem_acao: 'ia',
    responsavel_id: lead.responsavel_id ?? null,
  })
  log.ok('BOUNCE detectado — lead marcado e cadência cancelada.', {
    leadId: lead.id,
    empresa: lead.empresa,
    emailOriginal,
  })
  return true
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
