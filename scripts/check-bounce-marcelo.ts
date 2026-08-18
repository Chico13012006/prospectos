import fs from 'fs'
import path from 'path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const r = await client.query(
    `SELECT id, empresa, contato_email, bounced, bounced_em FROM leads WHERE contato_email='tirol@habibs.com.br'`
  )
  console.log('lead:', JSON.stringify(r.rows, null, 2))

  if (r.rows[0]) {
    const r2 = await client.query(
      `SELECT id, status, passo_atual FROM workflow_execucoes WHERE lead_id=$1 ORDER BY iniciado_em DESC`,
      [r.rows[0].id]
    )
    console.log('execucoes:', JSON.stringify(r2.rows, null, 2))
  }

  await client.end()
}

main().catch(console.error)
