/**
 * Materializa os MODELOS de workflow (Fase 11) como RASCUNHOS numa organização.
 * Idempotente (pula se já existe workflow com o mesmo nome). Cria SEMPRE como
 * rascunho (status 'rascunho') — INERTE: não inscreve leads nem envia nada até
 * alguém publicar deliberadamente. Não toca o motor de cadência.
 *
 *   npx tsx scripts/seed-workflow-modelos.ts <organizacao_id>
 */
import fs from 'node:fs'
import path from 'node:path'
import { createSupabaseAdminClient } from '../lib/supabase-admin'
import { SupabaseWorkflowStore } from '../lib/workflows/store/supabaseStore'
import { MODELOS } from '../lib/workflows/modelos'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const org = process.argv[2]
if (!org) { console.error('uso: seed-workflow-modelos.ts <organizacao_id>'); process.exit(2) }

async function main() {
  const store = new SupabaseWorkflowStore(org, createSupabaseAdminClient())
  const existentes = new Set((await store.listarWorkflows()).map((w) => w.nome))
  for (const m of MODELOS) {
    if (existentes.has(m.nome)) { console.log(`= já existe (pulado): ${m.nome}`); continue }
    const wf = await store.criarWorkflow({ nome: m.nome, rascunho_definicao: m.definicao })
    console.log(`+ criado rascunho: ${m.nome} (${wf.id})`)
  }
  console.log('OK — modelos como rascunho (inertes até publicar).')
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
