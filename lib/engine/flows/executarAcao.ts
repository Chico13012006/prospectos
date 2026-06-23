// FLUXO 1 — EXECUTAR AÇÃO
// Disparado quando alguém aciona uma ação na plataforma (ex.: "iniciar contato").
// Busca o lead, decide o próximo estágio, monta o e-mail pelo template, envia,
// registra a interação e avança o estágio. Respeita owner='engine', limite
// diário e idempotência (nunca reenvia o mesmo estágio ao mesmo lead).
import { OWNER_ENGINE, engineConfig } from '../config'
import { log } from '../logger'
import { montarMensagem, proximoEstagio, tipoDoEnvio } from '../templates'
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
  if (tipo === 'follow_up') {
    const enviados = await store.contarInteracoes(lead.id, 'follow_up')
    if (enviados >= engineConfig.maxFollowups) {
      log.aviso('Máximo de follow-ups atingido.', { leadId: lead.id, enviados })
      return { ok: false, motivo: 'max_followups' }
    }
  }

  // Limite diário (protege a reputação do domínio).
  if ((await store.enviosHoje()) >= engineConfig.maxEnviosDia) {
    log.aviso('Limite diário de envios atingido. Ação adiada.', {
      leadId: lead.id,
      limite: engineConfig.maxEnviosDia,
    })
    return { ok: false, motivo: 'limite_diario' }
  }

  const msg = montarMensagem(lead, destino)
  await email.enviar(lead.contato_email, msg.assunto, msg.corpo)
  await store.registrarInteracao({
    lead_id: lead.id,
    tipo,
    canal: 'email',
    descricao: `**${msg.assunto}**\n\n${msg.corpo}`,
    origem_acao: 'ia',
    responsavel_id: lead.responsavel_id ?? null,
  })

  const agora = new Date()
  const proxima = new Date(agora.getTime() + engineConfig.horasEntreFollowups * 3600_000)
  await store.atualizarLead(lead.id, {
    estagio: destino,
    ultimo_contato: agora.toISOString(),
    proxima_acao: 'follow_up',
    proxima_acao_data: proxima.toISOString(),
  })

  log.ok('Ação executada', { leadId: lead.id, de: lead.estagio, para: destino, tipo })
  return { ok: true, estagio: destino }
}
