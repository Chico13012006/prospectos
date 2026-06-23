// Provedor Gmail REAL (stub pronto para plugar). Implementa a mesma interface
// EmailProvider, então os fluxos não mudam ao trocar o simulado por este.
//
// Respeita MODO_ENSAIO: enquanto ensaio=true, NÃO envia — só loga, igual ao
// simulado. Para ativar de verdade, configure as variáveis GMAIL_* e
// MODO_ENSAIO=false, e instale `googleapis` (npm i googleapis).
//
// Nada aqui roda hoje: a fábrica em index.ts só escolhe o Gmail quando houver
// credenciais E MODO_ENSAIO=false. Mantido como caminho de evolução.
import type { EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { engineConfig } from '../config'
import { log } from '../logger'

export interface GmailCredenciais {
  clientId: string
  clientSecret: string
  refreshToken: string
  remetente: string // ex.: "Francisco | iNOVACODE <francisco@inovacode.com.br>"
}

export function lerCredenciaisGmail(): GmailCredenciais | null {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  const remetente = process.env.GMAIL_REMETENTE
  if (!clientId || !clientSecret || !refreshToken || !remetente) return null
  return { clientId, clientSecret, refreshToken, remetente }
}

export class GmailProvider implements EmailProvider {
  constructor(private cred: GmailCredenciais) {}

  async enviar(para: string, assunto: string, corpo: string): Promise<void> {
    if (engineConfig.modoEnsaio) {
      log.info('[ENSAIO] Gmail NÃO enviado (modoEnsaio)', { para, assunto })
      return
    }
    // Implementação real (descomente após `npm i googleapis`):
    //
    // const { google } = await import('googleapis')
    // const oauth2 = new google.auth.OAuth2(this.cred.clientId, this.cred.clientSecret)
    // oauth2.setCredentials({ refresh_token: this.cred.refreshToken })
    // const gmail = google.gmail({ version: 'v1', auth: oauth2 })
    // const raw = montarRaw(this.cred.remetente, para, assunto, corpo)
    // await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
    throw new Error('GmailProvider.enviar: instale `googleapis` e habilite o trecho real.')
  }

  async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
    if (engineConfig.modoEnsaio) {
      log.info('[ENSAIO] Gmail caixa NÃO lida (modoEnsaio)')
      return []
    }
    // Implementação real: gmail.users.messages.list({ q: 'is:unread newer_than:2d' })
    // → para cada msg, baixar, extrair From/Subject/body e mapear para MensagemRecebida.
    // O campo `automatica` pode vir de headers (Auto-Submitted, X-Autoreply) e é
    // reforçado por heurística em flows/detectarResposta.ts.
    throw new Error('GmailProvider.lerCaixaEntrada: instale `googleapis` e habilite o trecho real.')
  }
}
