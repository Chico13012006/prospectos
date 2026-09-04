import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { exigirConfirmacao } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = '03097614-9fd5-4491-a91c-589f84461683'

async function main() {
  exigirConfirmacao({
    nome: 'FIX BOUNCE — lead individual',
    alvo: 'org Laudos ' + ORG,
    efeitos: [
      'marca o lead como bounced=true e limpa próxima ação',
      'cancela as execuções de workflow ativas desse lead',
    ],
  })

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  // 1. Estado atual do Marcelo
  const r1 = await c.query(
    `SELECT id, empresa, contato_email, estagio, bounced, bounced_em, proxima_acao_data, followups_enviados
     FROM leads WHERE contato_email='tirol@habibs.com.br' AND organizacao_id=$1`,
    [ORG]
  )
  console.log('\n[1] Lead Marcelo (antes):', JSON.stringify(r1.rows[0], null, 2))

  if (r1.rows[0]) {
    const leadId = r1.rows[0].id

    // 2. Marcar bounce
    await c.query(
      `UPDATE leads SET bounced=true, bounced_em=now(), proxima_acao=null, proxima_acao_data=null
       WHERE id=$1`,
      [leadId]
    )
    console.log('\n[2] ✔ bounced=true marcado')

    // 3. Cancelar execuções ativas
    const r3 = await c.query(
      `UPDATE workflow_execucoes SET status='cancelado'
       WHERE lead_id=$1 AND status IN ('em_andamento','aguardando')
       RETURNING id, status, passo_atual`,
      [leadId]
    )
    console.log(`[3] ✔ ${r3.rowCount} execução(ões) cancelada(s):`, JSON.stringify(r3.rows, null, 2))

    // 4. Confirmar estado final
    const r4 = await c.query(
      `SELECT id, bounced, bounced_em FROM leads WHERE id=$1`, [leadId]
    )
    console.log('\n[4] Lead Marcelo (depois):', JSON.stringify(r4.rows[0], null, 2))
  }

  // 5. Qual lead está causando "follow_up_1 nicho=generico"?
  console.log('\n[5] Leads elegíveis p/ follow-up no motor tradicional (org BaseLaudos):')
  const r5 = await c.query(
    `SELECT id, empresa, contato_email, estagio, followups_enviados, proxima_acao, proxima_acao_data, bounced
     FROM leads
     WHERE organizacao_id=$1
       AND owner='engine'
       AND perdido=false
       AND bounced=false
       AND optout=false
       AND estagio IN ('primeiro_contato','aguardando_resposta','follow_up')
     ORDER BY proxima_acao_data`,
    [ORG]
  )
  console.log(JSON.stringify(r5.rows, null, 2))

  await c.end()
}

main().catch(console.error)
