// FLUXO 1 — EXECUTAR AÇÃO
// Disparado quando alguém aciona uma ação na plataforma (ex.: "iniciar contato").
// Busca o lead, decide o próximo estágio, monta o e-mail pelo template, envia,
// registra a interação e avança o estágio. Respeita owner='engine', limite
// diário e idempotência (nunca reenvia o mesmo estágio ao mesmo lead).
import { OWNER_ENGINE, getEngineConfig, proximaDataFollowup } from '../config'
import { log } from '../logger'
import { proximoEstagio, tipoDoEnvio } from '../templates'
import { montarEmail } from '../mensagem'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'

export interface ResultadoAcao {
  ok: boolean
  motivo?: string
  estagio?: string
}

export async function executarAcao(
  store: Store,
  email: EmailProvider,
  payload: { leadId: string },
): Promise<ResultadoAcao> {
  const cfg = await getEngineConfig(store.organizacaoId)
  const lead = await store.buscarLead(payload.leadId)
  if (!lead) {
    log.erro('Lead não encontrado', { leadId: payload.leadId })
    return { ok: false, motivo: 'nao_encontrado' }
  }

  // TRAVA de migração: só age em leads do motor.
  if (lead.owner !== OWNER_ENGINE) {
    log.aviso('Lead não é do motor (owner != engine). Ignorado.', {
      leadId: lead.id,
      owner: lead.owner,
    })
    return { ok: false, motivo: 'owner_nao_engine' }
  }
  if (lead.perdido) {
    log.aviso('Lead perdido. Ação ignorada.', { leadId: lead.id })
    return { ok: false, motivo: 'perdido' }
  }

  const tipo = tipoDoEnvio(lead.estagio)
  const destino = proximoEstagio(lead.estagio)
  if (destino === lead.estagio && lead.estagio !== 'follow_up') {
    log.aviso('Sem próximo estágio a executar.', { leadId: lead.id, estagio: lead.estagio })
    return { ok: false, motivo: 'sem_proximo_estagio', estagio: lead.estagio }
  }

  // IDEMPOTÊNCIA: nunca reenviar o mesmo estágio ao mesmo lead.
  if (tipo === 'abordagem' && (await store.contarInteracoes(lead.id, 'abordagem')) > 0) {
    log.aviso('Primeiro contato já enviado antes. Não reenviar.', { leadId: lead.id })
    return { ok: false, motivo: 'ja_enviado' }
  }
  // Cache do nº de follow-ups (migration 0003): só muda quando o envio é follow-up.
  let followupsEnviados = lead.followups_enviados ?? 0
  if (tipo === 'follow_up') {
    const enviados = await store.contarInteracoes(lead.id, 'follow_up')
    if (enviados >= cfg.maxFollowups) {
      log.aviso('Máximo de follow-ups atingido.', { leadId: lead.id, enviados })
      return { ok: false, motivo: 'max_followups' }
    }
    followupsEnviados = enviados + 1
  }

  // Limite diário (protege a reputação do domínio).
  if ((await store.enviosHoje()) >= cfg.maxEnviosDia) {
    log.aviso('Limite diário de envios atingido. Ação adiada.', {
      leadId: lead.id,
      limite: cfg.maxEnviosDia,
    })
    return { ok: false, motivo: 'limite_diario' }
  }

  const msg = await montarEmail(store, lead, {
    tipo,
    numero: tipo === 'follow_up' ? followupsEnviados : undefined,
  })
  await email.enviar(lead.contato_email, msg.assunto, msg.corpo)
  await store.registrarInteracao({
    lead_id: lead.id,
    tipo,
    canal: 'email',
    descricao: `**${msg.assunto}**\n\n${msg.corpo}`,
    origem_acao: 'ia',
    responsavel_id: lead.responsavel_id ?? null,
    template_id: msg.templateId, // A/B testing (item 6)
  })

  const agora = new Date()
  // Próxima data-alvo pela cadência de dias (item 3). Após o 1º contato
  // (abordagem) ancora em `agora` (= 1º contato) → 1º follow-up em dias[0].
  const jaEnviados = tipo === 'follow_up' ? followupsEnviados : 0
  const alvoAtual = tipo === 'follow_up' && lead.proxima_acao_data ? new Date(lead.proxima_acao_data) : null
  const proximaISO = proximaDataFollowup(cfg.diasFollowups, jaEnviados, alvoAtual, agora)
  await store.atualizarLead(lead.id, {
    estagio: destino,
    ultimo_contato: agora.toISOString(),
    proxima_acao: proximaISO ? 'follow_up' : null,
    proxima_acao_data: proximaISO,
    followups_enviados: followupsEnviados,
  })

  log.ok('Ação executada', { leadId: lead.id, de: lead.estagio, para: destino, tipo })
  return { ok: true, estagio: destino }
}
