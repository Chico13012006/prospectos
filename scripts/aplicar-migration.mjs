// Aplica UMA migration SQL de verdade no banco (pooler), lendo DATABASE_URL do
// .env.local. Uso:
//   node scripts/aplicar-migration.mjs db/migrations/0014_fundacoes_pipelines_config.sql
//
// O projeto não tem runner de migration; este é o padrão "pg --no-save" já
// registrado. Roda o arquivo inteiro numa transação (simple query protocol
// aceita múltiplos statements + do-blocks). Idempotente do lado do SQL.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const arg = process.argv[2]
if (!arg) {
  console.error('uso: node scripts/aplicar-migration.mjs <caminho/da/migration.sql>')
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const connectionString = env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL ausente no .env.local')
  process.exit(1)
}

const sql = fs.readFileSync(path.resolve(arg), 'utf8')
const client = new pg.Client({ connectionString })

try {
  await client.connect()
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  console.log(`✔ migration aplicada: ${arg}`)
} catch (e) {
  try { await client.query('rollback') } catch {}
  console.error(`✗ falhou (rollback): ${e.message}`)
  process.exit(1)
} finally {
  await client.end()
}
