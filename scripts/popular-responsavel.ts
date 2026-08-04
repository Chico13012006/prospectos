// Popula leads.responsavel_nome a partir do CSV do HubSpot ("Proprietário do
// contato"), casando por contato_email. Rode DEPOIS de aplicar a migration 0002:
//   npx tsx scripts/popular-responsavel.ts
// (antes era `node scripts/popular-responsavel.cjs`; virou tsx para reusar o
// parseCSV compartilhado e o mapearLead do HubSpot.)
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

import fs from 'node:fs'
import path from 'node:path'
import { parseCSV } from '../lib/leads/importarCsv'
import { mapearLead } from './hubspot-mapear'

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY as string, Authorization: `Bearer ${KEY}` }

async function main(): Promise<void> {
  const csv = fs.readFileSync(path.join(process.cwd(), 'hubspot_leads.csv'), 'latin1')
  const rows = parseCSV(csv)

  // email -> responsavel_nome (a partir do mapeamento oficial do import)
  const map = new Map<string, string>()
  for (const r of rows) {
    const m = mapearLead(r)
    if (m && m.contato_email && m.responsavel_nome) map.set(m.contato_email, m.responsavel_nome)
  }
  console.log(`CSV: ${map.size} e-mails com responsável.`)

  let atualizados = 0, semMatch = 0, erros = 0
  for (const [email, nome] of map) {
    const url = `${BASE}/rest/v1/leads?contato_email=eq.${encodeURIComponent(email)}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ responsavel_nome: nome }),
    })
    const txt = await res.text()
    if (!res.ok) {
      if (erros === 0) console.error('Erro (1ª ocorrência):', res.status, txt)
      erros++
      continue
    }
    const arr = JSON.parse(txt || '[]') as unknown[]
    if (arr.length === 0) semMatch++
    else atualizados += arr.length
  }
  console.log(`✅ responsavel_nome populado: ${atualizados} leads | sem match no banco: ${semMatch} | erros: ${erros}`)
}

main().catch((e) => { console.error('FAIL', (e as Error).message); process.exit(1) })
