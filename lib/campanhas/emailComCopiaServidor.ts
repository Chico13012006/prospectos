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
  await provider.enviar(
    mensagem.para,
    mensagem.assunto,
    mensagem.corpo,
    mensagem.html,
    responsavel.email.trim(),
  )
  return responsavel
}
