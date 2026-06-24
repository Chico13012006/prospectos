// Provedor Gmail REAL via SMTP (nodemailer). Implementa a mesma interface
// EmailProvider, então os fluxos não mudam ao trocar o simulado por este.
//
// Respeita MODO_ENSAIO: enquanto ensaio=true, NÃO envia — só loga, igual ao
// simulado. Para ativar de verdade, defina GMAIL_USER e GMAIL_APP_PASSWORD no
// .env.local (senha de app do Gmail) e MODO_ENSAIO=false.
//
// A fábrica em index.ts só escolhe o Gmail quando houver credenciais E
// MODO_ENSAIO=false.
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { engineConfig } from '../config'
import { log } from '../logger'

export interface GmailCredenciais {
  user: string // conta Gmail remetente (ex.: francisco@gmail.com)
  appPassword: string // senha de app de 16 caracteres
}

export function lerCredenciaisGmail(): GmailCredenciais | null {
  const user = process.env.GMAIL_USER
  const appPassword = process.env.GMAIL_APP_PASSWORD
  if (!user || !appPassword) return null
  return { user, appPassword }
}

export class GmailProvider implements EmailProvider {
  private transporter: Transporter | null = null

  constructor(private cred: GmailCredenciais) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: this.cred.user, pass: this.cred.appPassword },
      })
    }
    return this.transporter
  }

  async enviar(para: string, assunto: string, corpo: string): Promise<void> {
    if (engineConfig.modoEnsaio) {
      log.info('[ENSAIO] Gmail NÃO enviado (modoEnsaio)', { para, assunto })
      return
    }
    const info = await this.getTransporter().sendMail({
      from: this.cred.user,
      to: para,
      subject: assunto,
      text: corpo,
    })
    log.ok('E-mail enviado via Gmail (SMTP)', { para, assunto, messageId: info.messageId })
  }

  async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
    // TODO: leitura da caixa (IMAP) ainda não implementada. O Fluxo 2 roda com
    // o provedor simulado até esta parte existir.
    log.aviso('GmailProvider.lerCaixaEntrada: não implementado (TODO). Retornando vazio.')
    return []
  }
}
