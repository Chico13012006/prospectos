// Opt-out de follow-up por lead (sprint item 2.4).
//
// Token por lead SEM coluna: HMAC-SHA256(INTERNAL_SECRET, leadId) em base64url.
// É determinístico (recomputável na validação), específico do lead e NÃO
// adivinhável/sequencial — quem recebe o e-mail só consegue cancelar o próprio
// contato, e ninguém enumera leads por id (sem o segredo, o token não fecha).
import crypto from 'node:crypto'

function segredo(): string {
  const s = process.env.INTERNAL_SECRET
  if (!s) throw new Error('INTERNAL_SECRET não configurado (necessário p/ opt-out)')
  return s
}

export function gerarTokenOptout(leadId: string): string {
  return crypto.createHmac('sha256', segredo()).update(leadId).digest('base64url')
}

export function validarTokenOptout(leadId: string, token: string): boolean {
  if (!leadId || !token) return false
  const esperado = gerarTokenOptout(leadId)
  const a = Buffer.from(esperado)
  const b = Buffer.from(token)
  // Comparação em tempo constante (evita timing attack no token).
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// URL pública do rodapé (page de confirmação). Sem NEXT_PUBLIC_SITE_URL o link
// sai relativo — ainda funciona quando aberto no mesmo host.
export function urlOptout(leadId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
  const t = gerarTokenOptout(leadId)
  return `${base}/api/optout?lead=${encodeURIComponent(leadId)}&t=${encodeURIComponent(t)}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Rodapé em TEXTO puro (fallback do e-mail p/ clientes sem HTML).
export function rodapeTextoOptout(leadId: string): string {
  return `\n\n—\nSe não quiser mais receber estes e-mails, cancele aqui: ${urlOptout(leadId)}`
}

// Versão HTML do corpo (texto do template → parágrafos) + rodapé com o link de
// cancelamento. O corpo é escapado; quebras de linha viram <br>.
export function corpoHtmlComOptout(corpoTexto: string, leadId: string): string {
  const corpo = escapeHtml(corpoTexto).replace(/\n/g, '<br>')
  const link = urlOptout(leadId)
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">${corpo}</div>` +
    `<hr style="border:none;border-top:1px solid #e2e2e2;margin:20px 0 8px">` +
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a8a8a;margin:0">` +
    `Não quer mais receber estes e-mails? ` +
    `<a href="${link}" style="color:#8a8a8a">Cancelar o recebimento</a>.` +
    `</p>`
  )
}
