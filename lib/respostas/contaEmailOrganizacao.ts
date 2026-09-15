import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailProvider } from '@/lib/engine/email/provider'
import { GmailProvider, lerCredenciaisGmail, type GmailCredenciais } from '@/lib/engine/email/gmailProvider'

// Conta de e-mail de uma organização para envios HUMANOS a um lead (resposta
// pela Central, proposta ao cliente). Regra única — antes vivia inline em
// enviarEmailCentral, idêntica ao fluxo de campanha:
//   nomenclaturas.email_conta_key → credencial Gmail dedicada (GMAIL_USER_<KEY>);
//   chave configurada SEM credencial → bloqueia (nunca cai na conta padrão de
//   outra operação);
//   sem chave → provedor padrão do motor.
// `organizacaoId` vem sempre da sessão; a leitura filtra pelo id da organização.

export type ContaEmailOrganizacao =
  | { ok: true; provider: EmailProvider; nomeServico: string }
  | { ok: false; codigo: 'credencial_ausente'; mensagem: string }

export async function resolverContaEmailOrganizacao(
  db: SupabaseClient,
  organizacaoId: string,
  providerPadrao: EmailProvider,
  lerCredenciais: (chave: string) => GmailCredenciais | null = lerCredenciaisGmail,
): Promise<ContaEmailOrganizacao> {
  const { data: orgRow } = await db
    .from('organizacoes')
    .select('nome, configuracoes')
    .eq('id', organizacaoId)
    .maybeSingle()
  const orgData = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null
  const nomenclaturas = orgData?.configuracoes?.['nomenclaturas'] as Record<string, string> | undefined
  const nomeServico = nomenclaturas?.['nome_servico'] ?? orgData?.nome ?? ''
  const emailContaKey = nomenclaturas?.['email_conta_key']
  const emailCred = emailContaKey ? lerCredenciais(emailContaKey) : null
  if (emailContaKey && !emailCred) {
    return {
      ok: false,
      codigo: 'credencial_ausente',
      mensagem: `Envio bloqueado: credencial Gmail dedicada '${emailContaKey}' não configurada.`,
    }
  }
  return { ok: true, provider: emailCred ? new GmailProvider(emailCred) : providerPadrao, nomeServico }
}
