// Import do CSV do HubSpot BR para a tabela `leads`. Rode com:
//   npx tsx scripts/importar-hubspot.ts
// (antes era `node scripts/importar-hubspot.js`; virou tsx para importar o
// parser CSV compartilhado de lib/leads/importarCsv — parseCSV não é mais
// duplicado.) O mapeamento específico do HubSpot vive em ./hubspot-mapear.
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

import fs from 'node:fs'
import path from 'node:path'
import { parseCSV, dedupeInternaPorEmail } from '../lib/leads/importarCsv'
import { mapearLead, type HubspotLead } from './hubspot-mapear'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
// Service key só se estiver realmente configurada (não o placeholder); senão anon.
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_KEY = serviceKey && !serviceKey.includes('sua_')
  ? serviceKey
  : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// O CSV exportado do HubSpot BR vem em Latin-1 (Windows-1252), NÃO UTF-8.
const CSV_ENCODING = 'latin1' as const

async function buscarEmailsExistentes(): Promise<Set<string>> {
  const existentes = new Set<string>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=contato_email`, {
      headers: {
        apikey: SUPABASE_KEY as string,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Range-Unit': 'items',
        Range: `${from}-${from + PAGE - 1}`,
      },
    })
    if (!res.ok) throw new Error(`Erro ao ler emails existentes ${res.status}: ${await res.text()}`)
    const rows = (await res.json()) as Array<{ contato_email: string | null }>
    rows.forEach((r) => { if (r.contato_email) existentes.add(r.contato_email.toLowerCase()) })
    if (rows.length < PAGE) break
    from += PAGE
  }
  return existentes
}

async function inserirLote(leads: HubspotLead[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY as string,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(leads),
  })
  if (!res.ok) throw new Error(`Supabase erro ${res.status}: ${await res.text()}`)
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou chave do Supabase não encontrada no .env.local')
    process.exit(1)
  }

  const csvPath = path.join(process.cwd(), 'hubspot_leads.csv')
  if (!fs.existsSync(csvPath)) {
    console.error('❌ Arquivo hubspot_leads.csv não encontrado na raiz do projeto.')
    process.exit(1)
  }

  console.log('📂 Lendo CSV (Latin-1)...')
  const content = fs.readFileSync(csvPath, CSV_ENCODING)
  const rows = parseCSV(content)
  console.log(`📊 ${rows.length} linhas encontradas no CSV`)

  const leads = rows.map(mapearLead).filter((l): l is HubspotLead => l !== null)
  console.log(`✅ ${leads.length} leads com email válido`)
  console.log(`⚠️  ${rows.length - leads.length} linhas ignoradas (sem email)`)

  const { unicos, duplicados } = dedupeInternaPorEmail(leads)
  console.log(`🔍 ${unicos.length} leads únicos (${duplicados} duplicados no arquivo)`)

  console.log('🔗 Buscando emails já existentes no banco...')
  const existentes = await buscarEmailsExistentes()
  let leadsUnicos = unicos.filter((l) => !existentes.has(l.contato_email))
  console.log(`🚫 ${unicos.length - leadsUnicos.length} já existiam no banco e foram pulados`)
  console.log(`📥 ${leadsUnicos.length} leads novos para inserir`)

  if (leadsUnicos.length === 0) {
    console.log('\n✅ Nada a importar — banco já está em dia.')
    return
  }

  const LOTE = 50
  let importados = 0
  for (let i = 0; i < leadsUnicos.length; i += LOTE) {
    const lote = leadsUnicos.slice(i, i + LOTE)
    process.stdout.write(`⬆️  Inserindo leads ${i + 1}–${Math.min(i + LOTE, leadsUnicos.length)}...`)
    try {
      await inserirLote(lote)
      importados += lote.length
      console.log(' ✓')
    } catch (err) {
      console.log(' ✗')
      console.error(`   Erro no lote ${i / LOTE + 1}:`, (err as Error).message)
    }
  }

  console.log(`\n🎉 Importação concluída: ${importados} leads inseridos no Supabase`)
  console.log('   Estágio: novos_leads | Origem: hubspot')
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
