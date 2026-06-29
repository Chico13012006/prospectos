// Carrega a tabela `templates` do Supabase com o conteúdo do master
// (lib/engine/templates-seed.ts). IDEMPOTENTE: apaga TODAS as linhas e reinsere
// o conjunto completo — a fonte da verdade é o seed em código.
//
//   npx tsx scripts/seed-templates.ts
//
// Usa a service role se estiver configurada de verdade; senão cai na anon key
// (mesma lógica dos outros scripts do motor).
import { readFileSync } from 'node:fs'
import { SEED_TEMPLATES } from '../lib/engine/templates-seed'

// .env.local -> process.env (sem dependência externa)
for (const linha of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i > 0 && !linha.trim().startsWith('#')) {
    const k = linha.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!
const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
const usandoService = !!(sk && !sk.includes('sua_') && sk.startsWith('eyJ'))
const KEY = usandoService ? sk! : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function main() {
  console.log(`Supabase: ${BASE} | chave: ${usandoService ? 'service_role' : 'anon'}`)
  console.log(`Seed: ${SEED_TEMPLATES.length} templates a inserir.`)

  // 1) Apaga todas as linhas existentes (PostgREST exige filtro: id não-nulo).
  const del = await fetch(`${BASE}/rest/v1/templates?id=not.is.null`, {
    method: 'DELETE',
    headers: { ...H, Prefer: 'return=representation' },
  })
  if (!del.ok) {
    console.error(`✗ DELETE falhou (${del.status}): ${await del.text()}`)
    process.exit(1)
  }
  const apagadas = (await del.json()) as unknown[]
  console.log(`✓ ${apagadas.length} linha(s) antiga(s) apagada(s).`)

  // 2) Insere o conjunto do master.
  const rows = SEED_TEMPLATES.map((t) => ({
    canal: t.canal,
    nicho: t.nicho,
    tipo: t.tipo,
    nome: t.nome,
    assunto: t.assunto,
    corpo: t.corpo,
    ativo: true,
    taxa_resposta: 0,
  }))
  const ins = await fetch(`${BASE}/rest/v1/templates`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!ins.ok) {
    console.error(`✗ INSERT falhou (${ins.status}): ${await ins.text()}`)
    process.exit(1)
  }
  console.log(`✓ ${rows.length} templates inseridos.`)

  // 3) Confere a distribuição por canal.
  const check = await fetch(`${BASE}/rest/v1/templates?select=canal`, { headers: H })
  const all = (await check.json()) as { canal: string }[]
  const porCanal: Record<string, number> = {}
  for (const r of all) porCanal[r.canal] = (porCanal[r.canal] ?? 0) + 1
  console.log('Distribuição por canal:', JSON.stringify(porCanal))
  console.log(`Total na tabela: ${all.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
