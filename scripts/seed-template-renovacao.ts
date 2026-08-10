/**
 * Semeia o template inicial `renovacao_1` (canal e-mail, genérico) para UMA
 * organização, de forma IDEMPOTENTE (não duplica; não apaga nada). O texto fica
 * numa LINHA da tabela `templates` — editável na aba Templates, por org. O
 * processador de renovação lê este template (nada de texto hardcoded no código).
 *
 *   npx tsx scripts/seed-template-renovacao.ts [organizacao_id]
 * Default: organização de Laudos (LAUDO DE BRINQUEDOS).
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = process.argv[2] ?? '03097614-9fd5-4491-a91c-589f84461683'
const ASSUNTO = 'Renovação do laudo — {empresa}'
const CORPO = `Olá {nome}, tudo bem?

Verificamos que o laudo técnico da {empresa} está próximo do vencimento. Para manter a conformidade sem interrupção, o ideal é agendar a renovação com antecedência.

Podemos dar andamento na renovação? Se preferir, respondo com as datas e o passo a passo.

Atenciosamente, {responsavel_comercial}`

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  try {
    const existe = await c.query(
      `select id from templates where organizacao_id=$1 and canal='email' and tipo='renovacao_1'`, [ORG])
    if (existe.rowCount && existe.rowCount > 0) {
      console.log(`Template renovacao_1 já existe na org ${ORG} (id=${existe.rows[0].id}). Nada a fazer.`)
      return
    }
    const ins = await c.query(
      `insert into templates (organizacao_id, canal, nicho, tipo, nome, assunto, corpo, ativo, taxa_resposta)
       values ($1,'email',null,'renovacao_1','E-mail · Renovação · 1ª mensagem',$2,$3,true,0) returning id`,
      [ORG, ASSUNTO, CORPO])
    console.log(`✔ Template renovacao_1 criado na org ${ORG} (id=${ins.rows[0].id}).`)
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
