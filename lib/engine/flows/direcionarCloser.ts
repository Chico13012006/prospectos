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
import { substituirVariaveis } from '../mensagem'

export interface PayloadDirecionarCloser {
  leadId: string
  textoResposta: string
  responsavelCampanha?: UsuarioBasico | null
  // Inverte a ordem abaixo: o responsável do PRÓPRIO lead (carteira importada)
  // passa na frente e `responsavelCampanha` vira fallback. Quem decide é o
  // chamador — o handoff comercial nunca liga isto, porque o comercial sorteado
  // no rodízio tem prioridade absoluta (ver detectarResposta).
  preferirResponsavelDoLead?: boolean
  contextoCampanha?: ContextoCampanhaResposta | null
}

function dadosModeloResposta(
  lead: Lead,
  payload: PayloadDirecionarCloser,
  responsavelNome: string,
): Record<string, string> {
  const contato = lead.contato_nome?.trim() || 'Não configurado'
  const resposta = payload.textoResposta.trim() || 'Não configurado'
  return {
    empresa: lead.empresa?.trim() || 'Não configurado',
    contato,
    // Apelidos usados por modelos HTML feitos fora do produto: mesmo dado.
    nome_cliente: contato,
    email_contato: lead.contato_email?.trim() || 'Não configurado',
    nicho: lead.segmento?.trim() || 'Não configurado',
    score: Number.isFinite(lead.score) ? String(lead.score) : 'Não configurado',
    resposta,
    resposta_cliente: resposta,
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

  // Closer = responsável indicado pelo chamador (campanha ou handoff) e
  // responsável do lead, na ordem que `preferirResponsavelDoLead` definir;
  // fallback configurado (tela ou CLOSER_EMAIL) quando nenhum tem e-mail.
  //
  // O responsável do lead só é buscado quando entra na conta — campanha no modo
  // legado com responsável resolvido não faz a consulta extra.
  const buscarResponsavelDoLead = async (): Promise<UsuarioBasico | null> => {
    if (!lead.responsavel_id) return null
    const u = await store.buscarUsuario(lead.responsavel_id)
    return u?.email ? u : null
  }
  const daCampanha = payload.responsavelCampanha?.email ? payload.responsavelCampanha : null
  const escolhido = payload.preferirResponsavelDoLead
    ? (await buscarResponsavelDoLead()) ?? daCampanha
    : daCampanha ?? (await buscarResponsavelDoLead())

  let closerEmail = (await getEngineConfig(store.organizacaoId)).closerEmailFallback
  let closerNome = 'Closer'
  if (escolhido) {
    closerEmail = escolhido.email
    closerNome = escolhido.nome
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
    ? substituirVariaveis(payload.contextoCampanha.emailAssunto, dadosModelo)
    : `[ProspectOS] Lead respondeu: ${lead.empresa}`
  const corpoNotificacao = payload.contextoCampanha?.emailCorpo?.trim()
    ? substituirVariaveis(payload.contextoCampanha.emailCorpo, dadosModelo)
    : aviso
  const htmlPersonalizado = payload.contextoCampanha?.emailHtml?.trim()
    ? substituirVariaveis(payload.contextoCampanha.emailHtml, dadosModelo)
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
