// Bootstrap compartilhado dos runners do motor (scripts/).
// Carrega o .env.local ANTES de qualquer import da engine e prefere IPv4
// (em ambientes com IPv6 parcialmente quebrado o IMAP estanca).
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'

export function bootstrapEnv() {
  dns.setDefaultResultOrder('ipv4first')
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) {
    console.warn(`[bootstrap] .env.local não encontrado em ${p}`)
    return
  }
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    // Não sobrescreve env já presente (permite forçar valores na linha de comando).
    if (!(k in process.env)) process.env[k] = v
  }
}
