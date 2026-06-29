// FLUXO 4 — FOLLOW-UP AUTOMATIZADO (onde estão 80% das respostas)
// Roda na cadência diária (dias úteis). Pega leads ativos cujo tempo de espera
// já passou, respeita o limite diário e o máximo de follow-ups, envia o próximo,
// registra e avança o estágio.
//
// Quem já respondeu NUNCA entra aqui: a pausa do Fluxo 2 tira o lead da esteira
// (estagio='interessado'), e leadsParaFollowup só devolve estágios em cadência.
import { engineConfig } from '../config'
import { log } from '../logger'
import { proximoEstagio } from '../templates'
import { montarEmail } from '../mensagem'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'

export async function followUp(
  store: Store,
  email: EmailProvider,
): Promise<{ enviados: number; elegiveis: number; encerrados: number }> {
  // Saída automática: quem esgotou os follow-ups (>= MAX) sem responder e já
  // passou do tempo de espera sai da esteira para 'sem_resposta' (terminal,
  // fora do board ativo). Reversível por ação manual. O motor PARA aqui — nunca
  // leva além de "Respondeu".
  const esgotados = await store.leadsEsgotadosSemResposta()
  for (const lead of esgotados) {
    await store.atualizarLead(lead.id, { estagio: 'sem_resposta', proxima_acao: null, proxima_acao_data: null })
    await store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Sem resposta após ${engineConfig.maxFollowups} follow-ups. Movido para 'sem_resposta'.`,
      origem_acao: 'ia',
      responsavel_id: lead.responsavel_id ?? null,
    })
    log.ok('Lead encerrado por falta de resposta', { leadId: lead.id, empresa: lead.empresa })
  }

  const elegiveis = await store.leadsParaFollowup()
  if (elegiveis.length === 0) {
    log.info('Follow-up: nenhum lead elegível agora.')
    return { enviados: 0, elegiveis: 0, encerrados: esgotados.length }
  }

  log.info('Follow-up: leads elegíveis.', { quantidade: elegiveis.length })
  let enviados = 0

  for (const lead of elegiveis) {
    if ((await store.enviosHoje()) >= engineConfig.maxEnviosDia) {
      log.aviso('Limite diário atingido. Demais follow-ups ficam para o próximo dia útil.')
      break
    }

    // Idempotência reforçada (corrida): revalida a contagem antes de enviar.
    const jaEnviados = await store.contarInteracoes(lead.id, 'follow_up')
    if (jaEnviados >= engineConfig.maxFollowups) continue

    const destino = proximoEstagio(lead.estagio)
    const msg = await montarEmail(store, lead, { tipo: 'follow_up', numero: jaEnviados + 1 })
    await email.enviar(lead.contato_email, msg.assunto, msg.corpo)
    await store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'follow_up',
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
      // Mantém o cache (migration 0003) em dia: este envio é o follow-up nº jaEnviados+1.
      followups_enviados: jaEnviados + 1,
    })

    enviados++
    log.ok('Follow-up enviado', {
      leadId: lead.id,
      empresa: lead.empresa,
      numero: jaEnviados + 1,
      para: destino,
    })
  }

  return { enviados, elegiveis: elegiveis.length, encerrados: esgotados.length }
}
