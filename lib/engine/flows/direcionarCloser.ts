// FLUXO 3 — DIRECIONAR AO CLOSER (onde o dinheiro acontece)
// Monta um aviso com TODO o contexto pronto (empresa, nicho/segmento, tese
// comercial, texto da resposta) e notifica o closer (o responsável do lead, ou
// o fallback configurado). Marca o lead como 'com_closer'.
//
// Nota de modelagem: a UI agrupa o pipeline por `estagio`; mantemos
// estagio='interessado' (posição correta no funil) e gravamos o marcador de
// ciclo de vida em `proxima_acao='com_closer'` — sem coluna nova, sem quebrar a UI.
import { engineConfig } from '../config'
import { log } from '../logger'
import type { EmailProvider } from '../email/provider'
import type { Store } from '../store/store'

export async function direcionarCloser(
  store: Store,
  email: EmailProvider,
  payload: { leadId: string; textoResposta: string },
): Promise<{ ok: boolean; closer?: string }> {
  const lead = await store.buscarLead(payload.leadId)
  if (!lead) {
    log.erro('Lead não encontrado', { leadId: payload.leadId })
    return { ok: false }
  }

  // Closer = responsável do lead; fallback para CLOSER_EMAIL.
  let closerEmail = engineConfig.closerEmailFallback
  let closerNome = 'Closer'
  if (lead.responsavel_id) {
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

  if (!closerEmail) {
    log.aviso('Sem e-mail de closer (lead sem responsável e CLOSER_EMAIL vazio). Registrando mesmo assim.', {
      leadId: lead.id,
    })
  } else {
    await email.enviar(closerEmail, `[ProspectOS] Lead respondeu: ${lead.empresa}`, aviso)
  }

  await store.registrarInteracao({
    lead_id: lead.id,
    tipo: 'nota',
    canal: 'sistema',
    descricao: `Encaminhado ao closer (${closerNome} <${closerEmail || 'sem e-mail'}>).\n\n${aviso}`,
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
