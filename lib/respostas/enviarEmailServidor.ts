import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarMotorReal } from '@/lib/engine/scheduler'
import { GmailProvider, lerCredenciaisGmail } from '@/lib/engine/email/gmailProvider'
import { engineConfig } from '@/lib/engine/config'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'

// Envio de e-mail pela Central de Respostas — resposta HUMANA a um lead.
//
// Não é um motor novo: é o MESMO caminho de `AmbienteSupabase.enviarEmailTemplate`
// (lib/workflows/ambiente.ts), só que com assunto/corpo escritos pelo usuário
// em vez de template + variáveis. Reusa, na mesma ordem:
//   - criarMotorReal(org)         → Store (org-scoped) + GmailProvider padrão
//   - lerCredenciaisGmail(key)    → conta Gmail dedicada da org (email_conta_key)
//   - engineConfig.modoEnsaio     → trava global do motor de e-mail
//   - montarEmailCampanhaHtml     → HTML com assinatura do responsável
//   - store.registrarInteracao    → registro em `interacoes` (tipo='nota',
//                                   canal='email'), a fonte que a Central já lê
//
// `organizacaoId` vem SEMPRE da sessão (rota), nunca do browser. O lead é lido
// pelo Store, que filtra por organização — id de outra org não é encontrado.

export type CodigoErroEmail =
  | 'texto_vazio'
  | 'assunto_vazio'
  | 'lead_nao_encontrado'
  | 'sem_email'
  | 'optout'
  | 'bounced'
  | 'perdido'
  | 'credencial_ausente'
  | 'falha_envio'

export type ResultadoEnvioEmail =
  | { ok: true; simulado: true; motivo: 'modo_ensaio' }
  | { ok: true; simulado: false; interacaoRegistrada: boolean }
  | { ok: false; codigo: CodigoErroEmail; mensagem: string }

// Templates podem ser HTML. O motor já tem o caminho para isso —
// `htmlPersonalizado` em montarEmailCampanhaHtml (sanitizado) — só que hoje
// alimentado pela config da campanha. Aqui alimentamos pelo composer.
function pareceHtml(corpo: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(corpo ?? '')
}
// Alternativa em texto puro (parte text/plain e registro em `interacoes`).
function textoPlano(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function enviarEmailCentral(
  db: SupabaseClient,
  entrada: { leadId: string; assunto: string; texto: string; organizacaoId: string; usuarioId?: string | null },
): Promise<ResultadoEnvioEmail> {
  const assunto = entrada.assunto?.trim()
  const texto = entrada.texto?.trim()
  if (!assunto) return { ok: false, codigo: 'assunto_vazio', mensagem: 'Informe o assunto do e-mail.' }
  if (!texto) return { ok: false, codigo: 'texto_vazio', mensagem: 'A mensagem está vazia.' }

  const motor = criarMotorReal(entrada.organizacaoId)

  // ISOLAMENTO: buscarLead filtra por organizacao_id do Store.
  const lead = await motor.store.buscarLead(entrada.leadId)
  if (!lead) {
    return { ok: false, codigo: 'lead_nao_encontrado', mensagem: 'Lead não encontrado nesta organização.' }
  }

  // Travas do lead — as mesmas que tiram o lead da esteira do motor
  // (leadsParaFollowup): opt-out, bounce e perdido nunca recebem e-mail.
  const flags = lead as unknown as { optout?: boolean | null; bounced?: boolean | null; perdido?: boolean | null }
  if (flags.optout) {
    return { ok: false, codigo: 'optout', mensagem: 'Este lead pediu para não receber e-mails (opt-out).' }
  }
  if (flags.bounced) {
    return { ok: false, codigo: 'bounced', mensagem: 'O e-mail deste lead devolveu (bounce). Corrija o endereço antes de enviar.' }
  }
  if (flags.perdido) {
    return { ok: false, codigo: 'perdido', mensagem: 'Lead marcado como perdido. Reative-o antes de enviar.' }
  }
  if (!lead.contato_email?.trim()) {
    return { ok: false, codigo: 'sem_email', mensagem: 'O lead não tem e-mail cadastrado.' }
  }

  // Conta de e-mail e nome do serviço da organização — idêntico ao fluxo de
  // campanha (nomenclaturas.email_conta_key / nome_servico).
  const { data: orgRow } = await db
    .from('organizacoes')
    .select('nome, configuracoes')
    .eq('id', entrada.organizacaoId)
    .maybeSingle()
  const orgData = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null
  const nomenclaturas = orgData?.configuracoes?.['nomenclaturas'] as Record<string, string> | undefined
  const nomeServico = nomenclaturas?.['nome_servico'] ?? orgData?.nome ?? ''
  const emailContaKey = nomenclaturas?.['email_conta_key']
  const emailCred = emailContaKey ? lerCredenciaisGmail(emailContaKey) : null
  if (emailContaKey && !emailCred) {
    return {
      ok: false,
      codigo: 'credencial_ausente',
      mensagem: `Envio bloqueado: credencial Gmail dedicada '${emailContaKey}' não configurada.`,
    }
  }
  const provider = emailCred ? new GmailProvider(emailCred) : motor.email

  // Assinatura: responsável do lead (mesma regra do fluxo de campanha sem campanha).
  const responsavel = lead.responsavel_id ? await motor.store.buscarUsuario(lead.responsavel_id) : null
  const ehHtml = pareceHtml(texto)
  const corpoPlano = ehHtml ? textoPlano(texto) : texto
  const html = ehHtml
    ? montarEmailCampanhaHtml(corpoPlano, { responsavelNome: responsavel?.nome ?? null, nomeServico }, texto)
    : montarEmailCampanhaHtml(texto, { responsavelNome: responsavel?.nome ?? null, nomeServico })

  // MODO_ENSAIO: o GmailProvider já não envia em ensaio, mas aqui paramos ANTES
  // para também não registrar uma interação de um e-mail que não saiu.
  if (engineConfig.modoEnsaio) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'central.email',
      msg: 'MODO_ENSAIO: e-mail simulado, nada enviado nem registrado.',
      leadId: lead.id, organizacaoId: entrada.organizacaoId, caracteres: texto.length,
    }))
    return { ok: true, simulado: true, motivo: 'modo_ensaio' }
  }

  try {
    await provider.enviar(lead.contato_email, assunto, corpoPlano, html)
  } catch (e) {
    return {
      ok: false,
      codigo: 'falha_envio',
      mensagem: `Falha ao enviar: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Registro na fonte oficial. `origem_acao: 'humano'` porque foi uma pessoa
  // respondendo — o motor grava 'ia'. A Central lê nota+email como mensagem
  // enviada, então o e-mail aparece no histórico sem nenhum passo extra.
  // registrarInteracao também atualiza leads.ultimo_contato (canal='email').
  try {
    await motor.store.registrarInteracao({
      lead_id: lead.id,
      tipo: 'nota',
      canal: 'email',
      descricao: `**${assunto}**\n\n${corpoPlano}`,
      origem_acao: 'humano',
      responsavel_id: lead.responsavel_id ?? null,
    })
  } catch (e) {
    // O e-mail JÁ SAIU. Não devolver erro: o usuário reenviaria em dobro.
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'central.email',
      msg: 'E-mail enviado, mas falhou ao registrar a interação.',
      leadId: lead.id, erro: e instanceof Error ? e.message : String(e),
    }))
    return { ok: true, simulado: false, interacaoRegistrada: false }
  }

  return { ok: true, simulado: false, interacaoRegistrada: true }
}
