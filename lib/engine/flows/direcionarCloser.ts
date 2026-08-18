// FLUXO 3 — DIRECIONAR AO CLOSER (onde o dinheiro acontece)
// Monta um aviso com TODO o contexto pronto (empresa, nicho/segmento, tese
// comercial, texto da resposta) e notifica o closer (o responsável do lead, ou
// o fallback configurado). Marca o lead como 'com_closer'.
//
// Nota de modelagem: a UI agrupa o pipeline por `estagio`; mantemos
// estagio='interessado' (posição correta no funil) e gravamos o marcador de
// ciclo de vida em `proxima_acao='com_closer'` — sem coluna nova, sem quebrar a UI.
import { getEngineConfig } from '../config'
import { log } from '../logger'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'
import type { ContextoCampanhaResposta, Lead, UsuarioBasico } from '../types'
import { labelTipoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'

export interface PayloadDirecionarCloser {
  leadId: string
  textoResposta: string
  responsavelCampanha?: UsuarioBasico | null
  contextoCampanha?: ContextoCampanhaResposta | null
}

function materializarModeloResposta(modelo: string, dados: Record<string, string>): string {
  return Object.entries(dados).reduce(
    (texto, [chave, valor]) => texto.replaceAll(`{${chave}}`, valor),
    modelo,
  )
}

function dadosModeloResposta(
  lead: Lead,
  payload: PayloadDirecionarCloser,
  responsavelNome: string,
): Record<string, string> {
  return {
    empresa: lead.empresa?.trim() || 'Não configurado',
    contato: lead.contato_nome?.trim() || 'Não configurado',
    email_contato: lead.contato_email?.trim() || 'Não configurado',
    nicho: lead.segmento?.trim() || 'Não configurado',
    score: Number.isFinite(lead.score) ? String(lead.score) : 'Não configurado',
    resposta: payload.textoResposta.trim() || 'Não configurado',
    campanha: payload.contextoCampanha?.nome?.trim() || 'Não configurado',
    tipo_campanha: payload.contextoCampanha?.tipo
      ? labelTipoCampanha(payload.contextoCampanha.tipo)
      : 'Não configurado',
    responsavel: responsavelNome || 'Não configurado',
  }
}

export async function direcionarCloser(
  store: Store,
  email: EmailProvider,
  payload: PayloadDirecionarCloser,
): Promise<{ ok: boolean; closer?: string }> {
  const lead = await store.buscarLead(payload.leadId)
  if (!lead) {
    log.erro('Lead não encontrado', { leadId: payload.leadId })
    return { ok: false }
  }

  // Closer = responsável do lead; fallback configurado (tela ou CLOSER_EMAIL).
  let closerEmail = (await getEngineConfig(store.organizacaoId)).closerEmailFallback
  let closerNome = 'Closer'
  if (payload.responsavelCampanha?.email) {
    closerEmail = payload.responsavelCampanha.email
    closerNome = payload.responsavelCampanha.nome
  } else if (lead.responsavel_id) {
    const u = await store.buscarUsuario(lead.responsavel_id)
    if (u?.email) {
      closerEmail = u.email
      closerNome = u.nome
    }
  }

  const ms = lead.ultimo_contato ? Date.now() - new Date(lead.ultimo_contato).getTime() : 0
  const aviso = [
    'NOVA OPORTUNIDADE — ação do closer necessária',
    `Empresa : ${lead.empresa}  (nicho: ${lead.segmento ?? '-'}, score: ${lead.score})`,
    `Contato : ${lead.contato_nome ?? '-'} <${lead.contato_email}>`,
    `Tese    : ${lead.tese_comercial?.trim() || '-'}`,
    '',
    'Resposta do lead:',
    `  "${payload.textoResposta.trim()}"`,
  ].join('\n')
  const dadosModelo = dadosModeloResposta(lead, payload, closerNome)
  const assunto = payload.contextoCampanha?.emailAssunto?.trim()
    ? materializarModeloResposta(payload.contextoCampanha.emailAssunto, dadosModelo)
    : `[ProspectOS] Lead respondeu: ${lead.empresa}`
  const corpoNotificacao = payload.contextoCampanha?.emailCorpo?.trim()
    ? materializarModeloResposta(payload.contextoCampanha.emailCorpo, dadosModelo)
    : aviso
  const htmlPersonalizado = payload.contextoCampanha?.emailHtml?.trim()
    ? materializarModeloResposta(payload.contextoCampanha.emailHtml, dadosModelo)
    : undefined
  const htmlNotificacao = montarEmailCampanhaHtml(corpoNotificacao, {}, htmlPersonalizado)

  if (!closerEmail) {
    log.aviso('Sem e-mail de closer (lead sem responsável e CLOSER_EMAIL vazio). Registrando mesmo assim.', {
      leadId: lead.id,
    })
  } else if (payload.contextoCampanha?.notificarResponsavel !== false) {
    await email.enviar(closerEmail, assunto, corpoNotificacao, htmlNotificacao)
  }

  await store.registrarInteracao({
    lead_id: lead.id,
    tipo: 'nota',
    canal: 'sistema',
    descricao: `Encaminhado ao closer (${closerNome} <${closerEmail || 'sem e-mail'}>).\nAssunto: ${assunto}\n\n${corpoNotificacao}`,
    origem_acao: 'ia',
    responsavel_id: lead.responsavel_id ?? null,
  })
  await store.atualizarLead(lead.id, { estagio: 'interessado', proxima_acao: 'com_closer' })

  log.ok('Closer avisado', { leadId: lead.id, empresa: lead.empresa, closer: closerEmail })
  log.info('(métrica) tempo do último contato até avisar o closer (s)', {
    leadId: lead.id,
    segundos: Math.round(ms / 1000),
  })
  return { ok: true, closer: closerEmail }
}
