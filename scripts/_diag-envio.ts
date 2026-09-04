import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('=')
  if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_ID = '8f975fe1-a1d5-4964-9856-c46d12f8fdc5'

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  // 1. org configuracoes (email_conta_key, nomenclaturas)
  const org = await c.query(`SELECT nome, configuracoes FROM organizacoes WHERE id=$1`, [ORG])
  const cfg = org.rows[0]?.configuracoes as any
  console.log('email_conta_key:', cfg?.nomenclaturas?.email_conta_key)
  console.log('nome_servico:', cfg?.nomenclaturas?.nome_servico)

  // 2. template usado pela campanha
  const TEMPLATE_TIPO = 'campanha_8f975fe1a1d549649856c46d12f8fdc5_m1'
  const tpl = await c.query(
    `SELECT id, tipo, nicho, assunto, LEFT(corpo, 100) as corpo_preview FROM templates WHERE tipo=$1`,
    [TEMPLATE_TIPO]
  )
  console.log('\nTemplate:', JSON.stringify(tpl.rows, null, 2))

  // 3. lead
  const lead = await c.query(
    `SELECT id, empresa, contato_email, segmento FROM leads WHERE organizacao_id=$1 AND hubspot_id='piloto:meu-email'`,
    [ORG]
  )
  console.log('\nLead:', JSON.stringify(lead.rows, null, 2))

  // 4. interações registradas (evidência de envio)
  const inter = await c.query(
    `SELECT id, tipo, canal, LEFT(descricao, 100) as desc, criado_em FROM interacoes
     WHERE lead_id=$1 ORDER BY criado_em DESC LIMIT 5`,
    [lead.rows[0]?.id]
  )
  console.log('\nInterações recentes:', JSON.stringify(inter.rows, null, 2))

  // 5. env vars disponíveis
  console.log('\nGMAIL_USER_LAUDO:', process.env.GMAIL_USER_LAUDO || '(não definida)')
  console.log('GMAIL_APP_PASSWORD_LAUDO:', process.env.GMAIL_APP_PASSWORD_LAUDO ? '(definida)' : '(não definida)')

  await c.end()
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
