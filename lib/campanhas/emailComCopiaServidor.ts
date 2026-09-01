import 'server-only'
import type { EmailProvider } from '@/lib/engine/email/provider'
import type { UsuarioBasico } from '@/lib/engine/types'

export async function enviarEmailCampanhaComCopia(
  provider: EmailProvider,
  mensagem: {
    para: string
    assunto: string
    corpo: string
    html?: string
    remetenteEmail?: string | null
    responsavelCampanha?: UsuarioBasico | null
    responsavelLead?: UsuarioBasico | null
  },
): Promise<UsuarioBasico> {
  const responsavel = mensagem.responsavelCampanha?.email?.trim()
    ? mensagem.responsavelCampanha
    : mensagem.responsavelLead?.email?.trim()
      ? mensagem.responsavelLead
      : null
  if (!responsavel) {
    throw new Error('Envio bloqueado: o responsável comercial não possui e-mail para receber a cópia.')
  }
  const cc = responsavel.email.trim().toLowerCase() === mensagem.remetenteEmail?.trim().toLowerCase()
    ? undefined
    : responsavel.email.trim()
  await provider.enviar(
    mensagem.para,
    mensagem.assunto,
    mensagem.corpo,
    mensagem.html,
    cc,
  )
  return responsavel
}
