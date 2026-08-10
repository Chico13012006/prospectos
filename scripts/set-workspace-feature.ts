/**
 * Liga/desliga uma feature tipada no blob `organizacoes.configuracoes` de UMA
 * organização, passando pelo ÚNICO ponto de escrita (serializeWorkspaceConfig) —
 * preserva o resto do blob, valida e carimba a versão. Idempotente.
 *
 *   npx tsx scripts/set-workspace-feature.ts <orgId> <feature> <true|false>
 *   ex.: npx tsx scripts/set-workspace-feature.ts 03097614-9fd5-4491-a91c-589f84461683 empresaContatoReads true
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { parseWorkspaceConfig, serializeWorkspaceConfig } from '../lib/config/workspaceConfig'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const [orgId, feature, valorRaw] = process.argv.slice(2)
if (!orgId || !feature || (valorRaw !== 'true' && valorRaw !== 'false')) {
  console.error('uso: set-workspace-feature.ts <orgId> <feature> <true|false>')
  process.exit(2)
}
const valor = valorRaw === 'true'

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  try {
    const { rows } = await c.query('select nome, configuracoes from organizacoes where id = $1', [orgId])
    if (rows.length === 0) { console.error(`org ${orgId} não encontrada`); process.exit(1) }

    const atual = parseWorkspaceConfig(rows[0].configuracoes)
    const novo = serializeWorkspaceConfig({
      ...atual,
      features: { ...atual.features, [feature]: valor },
    })
    await c.query('update organizacoes set configuracoes = $1 where id = $2', [JSON.stringify(novo), orgId])

    // Confirma relendo do banco (prova de que gravou).
    const { rows: r2 } = await c.query('select configuracoes from organizacoes where id = $1', [orgId])
    const conferido = parseWorkspaceConfig(r2[0].configuracoes)
    console.log(`org "${rows[0].nome}" (${orgId})`)
    console.log(`features.${feature} = ${(conferido.features as Record<string, unknown> | undefined)?.[feature]}`)
    console.log('blob:', JSON.stringify(conferido))
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
