// Provedor Gmail REAL: ENVIO via SMTP (nodemailer) e LEITURA via IMAP (imapflow).
// Implementa a mesma interface EmailProvider, então os fluxos não mudam ao trocar
// o simulado por este.
//
// Respeita MODO_ENSAIO: enquanto ensaio=true, NÃO envia (só loga) e NÃO marca
// mensagens como lidas. Para ativar de verdade, defina GMAIL_USER e
// GMAIL_APP_PASSWORD no .env.local (senha de app do Gmail) e MODO_ENSAIO=false.
import nodemailer, { type Transporter } from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import type { EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { engineConfig } from '../config'
import { log } from '../logger'

// Padrões de assunto que indicam auto-resposta (férias/ausência/devolução).
const ASSUNTO_AUTO = [
  'fora do escrit', 'out of office', 'automatic reply', 'auto-reply', 'autoreply',
  'resposta autom', 'de férias', 'em férias', 'estou ausente', 'ausência',
  'undeliverable', 'mail delivery', 'returned mail', 'delivery status notification',
]

// Detecta auto-resposta pelos CABEÇALHOS (Auto-Submitted, X-Autoreply, Precedence)
// e, como reforço, pelo assunto. Os fluxos não enxergam cabeçalhos — por isso o
// provedor é o lugar certo para essa marcação.
function detectarAutomatica(parsed: ParsedMail): boolean {
  const h = parsed.headers
  const autoSubmitted = String(h.get('auto-submitted') ?? '').toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true
  if (h.has('x-autoreply') || h.has('x-autorespond') || h.has('x-auto-response-suppress')) return true
  const precedence = String(h.get('precedence') ?? '').toLowerCase()
  if (['auto_reply', 'bulk', 'junk'].includes(precedence)) return true
  const assunto = (parsed.subject ?? '').toLowerCase()
  return ASSUNTO_AUTO.some((p) => assunto.includes(p))
}

function corpoTexto(parsed: ParsedMail): string {
  if (parsed.text && parsed.text.trim()) return parsed.text.trim()
  if (parsed.html) return parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return ''
}

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
    log.ok('E-mail enviado via Gmail (SMTP)', {
      remetente: this.cred.user,
      para,
      assunto,
      messageId: info.messageId,
    })
  }

  // Lê as mensagens NÃO LIDAS da INBOX via IMAP (imap.gmail.com:993, SSL) e as
  // mapeia para o formato que o Fluxo 2 (detectarResposta) espera.
  // Em MODO_ENSAIO a leitura acontece normalmente (não é envio), mas as mensagens
  // NÃO são marcadas como lidas — para não mexer na sua caixa durante testes.
  async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: this.cred.user, pass: this.cred.appPassword },
      logger: false,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    })
    // ImapFlow emite 'error' de forma assíncrona; sem um listener, um timeout de
    // socket viraria "unhandled error" e derrubaria o processo. Aqui só logamos —
    // a falha de connect()/fetch() já é propagada como exceção normal.
    client.on('error', (e: unknown) => {
      log.aviso('IMAP erro de conexão', { erro: e instanceof Error ? e.message : String(e) })
    })

    const mensagens: MensagemRecebida[] = []
    await client.connect()
    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Busca os UIDs das NÃO LIDAS; se não houver, evita o fetch.
        const uids = await client.search({ seen: false }, { uid: true })
        if (!uids || uids.length === 0) {
          log.info('Caixa lida via IMAP', { naoLidas: 0, marcadasComoLidas: 0 })
          return []
        }
        // Limita ao lote mais recente (UIDs maiores = mais recentes). Protege
        // contra caixas com milhares de não lidas — baixar o source de todas
        // estouraria o socket. Configurável via GMAIL_MAX_FETCH (padrão 50).
        const limite = Math.max(1, Number(process.env.GMAIL_MAX_FETCH ?? '50') || 50)
        const recentes = uids.slice(-limite)
        if (uids.length > recentes.length) {
          log.aviso('Muitas não lidas; processando só as mais recentes', {
            totalNaoLidas: uids.length,
            processando: recentes.length,
          })
        }
        // Baixa o source para parse MIME completo. IMPORTANTE: não emitir outro
        // comando IMAP (ex.: marcar lida) DENTRO deste laço — o imapflow não
        // permite comandos concorrentes durante um fetch em streaming e isso
        // trava a conexão. Coletamos os UIDs e marcamos DEPOIS do laço.
        const uidsLidos: number[] = []
        for await (const m of client.fetch(recentes, { source: true, uid: true }, { uid: true })) {
          const parsed = await simpleParser(m.source as Buffer)
          const de = parsed.from?.value?.[0]?.address?.toLowerCase() ?? ''
          mensagens.push({
            de,
            assunto: parsed.subject ?? '',
            corpo: corpoTexto(parsed),
            automatica: detectarAutomatica(parsed),
            em: parsed.date ?? new Date(),
          })
          if (m.uid) uidsLidos.push(m.uid)
        }

        // Consome as mensagens (marca como lidas) só fora do ensaio — agora que
        // o fetch terminou, é seguro emitir o comando.
        let marcadas = 0
        if (!engineConfig.modoEnsaio && uidsLidos.length) {
          await client.messageFlagsAdd(uidsLidos, ['\\Seen'], { uid: true })
          marcadas = uidsLidos.length
        }
        log.info('Caixa lida via IMAP', { naoLidas: mensagens.length, marcadasComoLidas: marcadas })
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    return mensagens
  }
}
