/**
 * Piloto de envio real — campanha Reativação de Clientes.
 *
 * Cria uma campanha piloto separada (dry_run=false) ligada ao mesmo workflow v5,
 * sem tocar nos 283 leads da campanha principal (dry_run=true).
 *
 * Modos:
 *   --meu-email
 *     Cria/reutiliza um lead de teste com o seu e-mail (franrufs13@gmail.com) e
 *     envia T1 só para você. Após confirmar que chegou bem, delete o piloto e
 *     libere dry_run na campanha principal via UI.
 *
 *   --real [N]   (padrão N=5)
 *     Seleciona N leads reais da base de 283, CANCELA as execuções deles na
 *     campanha principal e os inscreve no piloto (dry_run=false). Os demais ficam
 *     intocados. Após validar, esses N leads continuam a cadência completa pelo
 *     piloto; libere dry_run na campanha principal para os restantes.
 *
 * Ao final, dispara automaticamente o processador (requer app rodando na :3000)
 * e mostra o curl de fallback caso o app não esteja disponível.
 *
 * Usage:
 *   npx tsx scripts/piloto-reativacao.ts --meu-email
 *   npx tsx scripts/piloto-reativacao.ts --real
 *   npx tsx scripts/piloto-reativacao.ts --real 10
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG           = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_MAIN = 'cd82b32a-ccf2-4cda-8190-60a802b37041'
const WORKFLOW_ID   = '11593652-03c4-4091-b802-35d75ec30b8b'
const MEU_EMAIL     = 'franrufs13@gmail.com'

// Analisa args.
const args = process.argv.slice(2)
const modoMeuEmail = args.includes('--meu-email')
const modoReal     = args.includes('--real')

if (!modoMeuEmail && !modoReal) {
  console.error('Uso: npx tsx scripts/piloto-reativacao.ts --meu-email | --real [N]')
  process.exit(1)
}

const nReal = (() => {
  const idx = args.indexOf('--real')
  const prox = args[idx + 1]
  return prox && /^\d+$/.test(prox) ? parseInt(prox, 10) : 5
})()

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log(`=== Piloto Reativação — modo: ${modoMeuEmail ? '--meu-email' : `--real ${nReal}`} ===`)

    // Busca versão ativa do workflow (a que o script de atualização publicou).
    const versRes = await c.query(
      `SELECT versao_atual_id FROM workflows WHERE id=$1`,
      [WORKFLOW_ID]
    )
    const versaoId = versRes.rows[0]?.versao_atual_id as string | undefined
    if (!versaoId) throw new Error('Workflow sem versão ativa — rode atualizar-workflow-reativacao.ts antes.')

    // Cria (ou reutiliza) a campanha piloto.
    console.log('\n[1] Campanha piloto...')
    const campPilRes = await c.query(
      `SELECT id, dry_run FROM campanhas WHERE organizacao_id=$1 AND nome='Reativação — Piloto'`,
      [ORG]
    )
    let campanhaId: string
    if (campPilRes.rowCount && campPilRes.rowCount > 0) {
      campanhaId = campPilRes.rows[0].id as string
      // Garante dry_run=false caso a campanha já exista mas estivesse travada.
      if (campPilRes.rows[0].dry_run !== false) {
        await c.query(`UPDATE campanhas SET dry_run=false WHERE id=$1`, [campanhaId])
        console.log(`  ✔ Campanha piloto existente — dry_run forçado para false (id=${campanhaId})`)
      } else {
        console.log(`  ✔ Campanha piloto existente (id=${campanhaId})`)
      }
    } else {
      const ins = await c.query(
        `INSERT INTO campanhas (organizacao_id, nome, descricao, tipo, status, workflow_id, publico, dry_run)
         VALUES ($1,'Reativação — Piloto','Envio piloto controlado antes de liberar os 283.','reativacao','ativa',$2,'{}',false)
         RETURNING id`,
        [ORG, WORKFLOW_ID]
      )
      campanhaId = ins.rows[0].id as string
      console.log(`  ✔ Campanha piloto criada (id=${campanhaId})`)
    }

    let leadIds: string[] = []

    if (modoMeuEmail) {
      // ── Modo --meu-email: cria/reutiliza lead de teste com o seu e-mail. ──
      console.log('\n[2] Lead de teste (seu e-mail)...')
      const testeRes = await c.query(
        `SELECT id FROM leads WHERE organizacao_id=$1 AND hubspot_id='piloto:meu-email'`,
        [ORG]
      )
      let leadId: string
      if (testeRes.rowCount && testeRes.rowCount > 0) {
        leadId = testeRes.rows[0].id as string
        console.log(`  ✔ Lead de teste já existe (id=${leadId})`)
      } else {
        const insL = await c.query(
          `INSERT INTO leads
             (organizacao_id, empresa, cidade, estado, segmento, faixa_funcionarios,
              contato_nome, contato_cargo, contato_email, canal_preferencial,
              estagio, score, owner, perdido, origem, hubspot_id)
           VALUES ($1,'[PILOTO] Laudo de Brinquedos','São Paulo','SP',NULL,'1-10',
                   'Francisco Rufino','Sócio',$2,'email',
                   'aguardando_resposta',80,'engine',false,'piloto','piloto:meu-email')
           RETURNING id`,
          [ORG, MEU_EMAIL]
        )
        leadId = insL.rows[0].id as string
        console.log(`  ✔ Lead de teste criado (id=${leadId}, email=${MEU_EMAIL})`)
      }
      leadIds = [leadId]

    } else {
      // ── Modo --real N: seleciona N leads da campanha principal. ──
      console.log(`\n[2] Selecionando ${nReal} leads reais da campanha principal...`)

      // Pega leads que já têm execução na campanha principal e ainda não estão
      // no piloto (evita duplicar em re-runs).
      const leadsRes = await c.query(
        `SELECT we.lead_id, l.empresa, l.contato_nome, l.contato_email
         FROM workflow_execucoes we
         JOIN leads l ON l.id = we.lead_id
         WHERE we.campanha_id = $1
           AND we.status IN ('em_andamento','aguardando')
           AND NOT EXISTS (
             SELECT 1 FROM workflow_execucoes wp
             WHERE wp.campanha_id=$2 AND wp.lead_id=we.lead_id
           )
         ORDER BY we.iniciado_em
         LIMIT $3`,
        [CAMPANHA_MAIN, campanhaId, nReal]
      )

      if (!leadsRes.rowCount || leadsRes.rowCount === 0) {
        console.log('  ✔ Nenhum lead novo para mover (todos já estão no piloto ou não há pendentes).')
        leadIds = []
      } else {
        leadIds = leadsRes.rows.map((r: { lead_id: string }) => r.lead_id)
        console.log(`  → ${leadIds.length} leads selecionados:`)
        for (const r of leadsRes.rows as { lead_id: string; empresa: string; contato_nome: string; contato_email: string }[]) {
          console.log(`    • ${r.contato_nome ?? '-'} / ${r.empresa} <${r.contato_email}>`)
        }

        // Cancela execuções desses leads na campanha principal (evita que recebam
        // T1 duplo quando dry_run for levantado nos 273+).
        await c.query(
          `UPDATE workflow_execucoes SET status='cancelado'
           WHERE campanha_id=$1 AND lead_id = ANY($2::uuid[])`,
          [CAMPANHA_MAIN, leadIds]
        )
        console.log(`  ✔ Execuções na campanha principal canceladas para esses ${leadIds.length} leads.`)
      }
    }

    // Inscreve os leads no piloto (pula quem já tem execução ativa no piloto).
    if (leadIds.length > 0) {
      console.log(`\n[3] Inscrevendo ${leadIds.length} lead(s) no piloto...`)
      const execRows = await c.query(
        `INSERT INTO workflow_execucoes
           (organizacao_id, workflow_id, versao_id, lead_id, campanha_id, passo_atual, status)
         SELECT $1, $2, $3, unnest($4::uuid[]), $5, 0, 'em_andamento'
         ON CONFLICT DO NOTHING
         RETURNING id, lead_id`,
        [ORG, WORKFLOW_ID, versaoId, leadIds, campanhaId]
      )
      const inscritos = execRows.rowCount ?? 0
      console.log(`  ✔ ${inscritos} execução(ões) criada(s) no piloto.`)

      // Evento de início para cada execução nova.
      if (execRows.rows.length > 0) {
        const vals = execRows.rows
          .map((_: unknown, i: number) => `($1, $${i + 2}, 'execucao_iniciada', $${execRows.rows.length + i + 2})`)
          .join(',')
        const params: unknown[] = [ORG,
          ...execRows.rows.map((r: { id: string }) => r.id),
          ...execRows.rows.map((r: { id: string }) => JSON.stringify({
            versao_id: versaoId, via: 'piloto', campanha_id: campanhaId,
          })),
        ]
        await c.query(
          `INSERT INTO workflow_execucao_eventos (organizacao_id, execucao_id, tipo, detalhe) VALUES ${vals}`,
          params
        )
      }
    }

    // Dispara o processador de workflows (requer app rodando na porta 3000).
    const secret = process.env.INTERNAL_SECRET ?? ''
    const processorUrl = 'http://localhost:3000/api/workflows/processar'
    console.log(`\n[4] Disparando processador de workflows...`)
    try {
      const resp = await fetch(processorUrl, {
        method: 'POST',
        headers: { 'x-internal-secret': secret },
      })
      if (resp.ok) {
        const json = await resp.json() as Record<string, unknown>
        console.log(`  ✔ Processador respondeu OK:`, JSON.stringify(json).slice(0, 200))
        console.log(`  → T1 deve ter sido enviado agora. Verifique sua caixa de entrada.`)
      } else {
        console.log(`  ✗ Processador retornou ${resp.status} — app não está rodando?`)
        imprimirCurl(processorUrl, secret)
      }
    } catch {
      console.log(`  ✗ Não conseguiu conectar ao app local — rode o comando abaixo manualmente:`)
      imprimirCurl(processorUrl, secret)
    }

    console.log(`\n${'═'.repeat(60)}`)
    console.log('PILOTO CONFIGURADO:')
    console.log(`  Campanha piloto  : ${campanhaId}`)
    console.log(`  dry_run piloto   : FALSE (envio real ativo)`)
    console.log(`  dry_run principal: TRUE  (283 leads intocados)`)
    console.log(`  Leads no piloto  : ${leadIds.length}`)
    if (modoMeuEmail) {
      console.log(`  E-mail de teste  : ${MEU_EMAIL}`)
      console.log(`\nApós confirmar recebimento:`)
      console.log(`  1. Libere dry_run na campanha principal via UI (ou SQL abaixo)`)
      console.log(`  2. Exclua o lead de teste se quiser (hubspot_id='piloto:meu-email')`)
    } else {
      console.log(`\nApós confirmar que os ${leadIds.length} leads receberam corretamente:`)
      console.log(`  1. Libere dry_run na campanha principal via UI (ou SQL abaixo)`)
      console.log(`     Os ${leadIds.length} leads do piloto continuam a cadência completa pelo piloto.`)
    }
    console.log(`\nSQL para liberar a campanha principal (quando decidir):`)
    console.log(`  UPDATE campanhas SET dry_run=false WHERE id='${CAMPANHA_MAIN}';`)
    console.log(`${'═'.repeat(60)}`)
  } finally {
    await c.end()
  }
}

function imprimirCurl(url: string, secret: string) {
  console.log(`\n  Quando o app estiver rodando (npm run dev), execute:`)
  console.log(`  curl -s -X POST ${url} -H "x-internal-secret: ${secret || '<INTERNAL_SECRET>'}"`)
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
