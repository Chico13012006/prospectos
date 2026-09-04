/**
 * Liberação dividida — campanha Reativação de Clientes.
 *
 * Passo 1: Move os 80 leads @habibs.com.br da campanha principal para duas
 *           campanhas separadas:
 *             - "Reativação — Lote Habib's (aguardando)" dry_run=true  → 68 leads
 *             - "Reativação — Lote Habib's Piloto"       dry_run=false → 12 leads
 * Passo 2: Ativa dry_run=false na campanha principal (os ~199 restantes).
 * Passo 3: Relatório com counts reais.
 *
 * ENSAIO por padrão: sem `--confirmar`, as leituras rodam e o script relata
 * o que faria, sem gravar nada.
 *
 * Uso:
 *   npx tsx scripts/liberacao-dividida-habibs.ts              (ensaio)
 *   npx tsx scripts/liberacao-dividida-habibs.ts --confirmar  (grava)
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG           = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_MAIN = 'cd82b32a-ccf2-4cda-8190-60a802b37041'
const WORKFLOW_ID   = '11593652-03c4-4091-b802-35d75ec30b8b'
const N_PILOTO      = 12
const LIMITE_HABIBS = 120 // recusa se o filtro pegar muito mais que os ~80 esperados

async function criarOuReutilizarCampanha(
  c: pg.Client,
  nome: string,
  descricao: string,
  dryRun: boolean,
  real: boolean,
): Promise<string> {
  const sel = await c.query<{ id: string; dry_run: boolean }>(
    `SELECT id, dry_run FROM campanhas WHERE organizacao_id=$1 AND nome=$2`,
    [ORG, nome]
  )
  if (sel.rowCount && sel.rowCount > 0) {
    const id = sel.rows[0].id
    if (sel.rows[0].dry_run !== dryRun) {
      if (real) await c.query(`UPDATE campanhas SET dry_run=$1 WHERE id=$2`, [dryRun, id])
      console.log(`  ${real ? '✔' : '○'} Campanha existente "${nome}" — dry_run ${real ? 'atualizado para' : 'seria alterado para'} ${dryRun} (id=${id})`)
    } else {
      console.log(`  ✔ Campanha existente "${nome}" (id=${id}, dry_run=${dryRun})`)
    }
    return id
  }
  if (!real) {
    console.log(`  ○ Criaria campanha "${nome}" (dry_run=${dryRun})`)
    return `(ensaio:${nome})`
  }
  const ins = await c.query<{ id: string }>(
    `INSERT INTO campanhas (organizacao_id, nome, descricao, tipo, status, workflow_id, publico, dry_run)
     VALUES ($1,$2,$3,'reativacao','ativa',$4,'{}', $5)
     RETURNING id`,
    [ORG, nome, descricao, WORKFLOW_ID, dryRun]
  )
  const id = ins.rows[0].id
  console.log(`  ✔ Campanha criada "${nome}" (id=${id}, dry_run=${dryRun})`)
  return id
}

async function inscreverLeads(
  c: pg.Client,
  versaoId: string,
  campanhaId: string,
  leadIds: string[],
  real: boolean,
): Promise<number> {
  if (leadIds.length === 0) return 0
  if (!real) return leadIds.length
  const res = await c.query<{ id: string; lead_id: string }>(
    `INSERT INTO workflow_execucoes
       (organizacao_id, workflow_id, versao_id, lead_id, campanha_id, passo_atual, status)
     SELECT $1, $2, $3, unnest($4::uuid[]), $5, 0, 'em_andamento'
     ON CONFLICT DO NOTHING
     RETURNING id, lead_id`,
    [ORG, WORKFLOW_ID, versaoId, leadIds, campanhaId]
  )
  const inscritos = res.rowCount ?? 0
  // Eventos de início
  if (res.rows.length > 0) {
    const vals = res.rows
      .map((_: unknown, i: number) => `($1, $${i + 2}, 'execucao_iniciada', $${res.rows.length + i + 2})`)
      .join(',')
    const params: unknown[] = [
      ORG,
      ...res.rows.map((r) => r.id),
      ...res.rows.map(() => JSON.stringify({ versao_id: versaoId, via: 'liberacao-dividida', campanha_id: campanhaId })),
    ]
    await c.query(
      `INSERT INTO workflow_execucao_eventos (organizacao_id, execucao_id, tipo, detalhe) VALUES ${vals}`,
      params
    )
  }
  return inscritos
}

async function main() {
  const real = anunciarModo({
    nome: 'LIBERAÇÃO DIVIDIDA — Reativação de Clientes',
    alvo: `org Laudos ${ORG} · campanha principal ${CAMPANHA_MAIN}`,
    efeitos: [
      "cria/reutiliza as campanhas \"Lote Habib's Piloto\" (dry_run=false) e \"(aguardando)\" (dry_run=true)",
      'cancela as execuções dos leads @habibs.com.br na campanha principal',
      'inscreve esses leads nas duas campanhas novas',
      'libera dry_run=FALSE na campanha principal — a partir daí o motor envia e-mail REAL',
    ],
  })

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {

    // Versão ativa do workflow
    const versRes = await c.query<{ versao_atual_id: string }>(
      `SELECT versao_atual_id FROM workflows WHERE id=$1`, [WORKFLOW_ID]
    )
    const versaoId = versRes.rows[0]?.versao_atual_id
    if (!versaoId) throw new Error('Workflow sem versão ativa.')

    // ── Passo 1: Identificar os 80 leads @habibs.com.br na campanha principal ──
    console.log('\n[Passo 1] Identificando leads @habibs.com.br na campanha principal...')
    const habibsRes = await c.query<{ lead_id: string; empresa: string; contato_email: string }>(
      `SELECT we.lead_id, l.empresa, l.contato_email
       FROM workflow_execucoes we
       JOIN leads l ON l.id = we.lead_id
       WHERE we.campanha_id = $1
         AND we.status IN ('em_andamento','aguardando')
         AND l.bounced IS NOT TRUE
         AND lower(l.contato_email) LIKE '%@habibs.com.br'
       ORDER BY we.iniciado_em`,
      [CAMPANHA_MAIN]
    )
    const habibsLeads = habibsRes.rows
    console.log(`  → ${habibsLeads.length} leads @habibs.com.br encontrados na campanha principal.`)
    if (habibsLeads.length === 0) throw new Error('Nenhum lead @habibs.com.br encontrado — verifique.')
    limiteSeguranca(habibsLeads.length, LIMITE_HABIBS, 'leads @habibs.com.br')

    const todosHabibsIds = habibsLeads.map((r) => r.lead_id)
    const pilotoIds      = todosHabibsIds.slice(0, N_PILOTO)
    const aguardandoIds  = todosHabibsIds.slice(N_PILOTO)

    console.log(`  → Divisão: ${pilotoIds.length} para piloto (dry_run=false), ${aguardandoIds.length} aguardando (dry_run=true)`)

    // Criar campanhas Habib's
    const campPilotoId    = await criarOuReutilizarCampanha(
      c,
      "Reativação — Lote Habib's Piloto",
      'Teste controlado: 12 leads do domínio habibs.com.br — envio real para validar entregabilidade.',
      false,
      real,
    )
    const campAguardandoId = await criarOuReutilizarCampanha(
      c,
      "Reativação — Lote Habib's (aguardando)",
      '68 leads habibs.com.br aguardando resultado do piloto de 12 antes de liberar.',
      true,
      real,
    )

    // Cancelar execuções dos 80 na campanha principal
    const cancelRes = real
      ? await c.query(
          `UPDATE workflow_execucoes SET status='cancelado'
           WHERE campanha_id=$1 AND lead_id = ANY($2::uuid[])
             AND status IN ('em_andamento','aguardando')`,
          [CAMPANHA_MAIN, todosHabibsIds]
        )
      : { rowCount: todosHabibsIds.length }
    console.log(
      `  ${real ? '✔' : '○'} ${cancelRes.rowCount ?? 0} execuções ${real ? 'canceladas' : 'seriam canceladas'} na campanha principal para leads Habib's.`
    )

    // Inscrever no piloto (12)
    const inscritosPiloto = await inscreverLeads(c, versaoId, campPilotoId, pilotoIds, real)
    console.log(`  ${real ? '✔' : '○'} ${inscritosPiloto} leads ${real ? 'inscritos' : 'seriam inscritos'} no piloto Habib's (dry_run=false).`)

    // Inscrever nos aguardando (68)
    const inscritosAguardando = await inscreverLeads(c, versaoId, campAguardandoId, aguardandoIds, real)
    console.log(`  ${real ? '✔' : '○'} ${inscritosAguardando} leads ${real ? 'inscritos' : 'seriam inscritos'} na campanha aguardando (dry_run=true).`)

    // ── Passo 2: Liberar dry_run=false na campanha principal ──────────────
    console.log('\n[Passo 2] Liberando dry_run=false na campanha principal...')

    // Contagem real antes de liberar
    const restantesRes = await c.query<{ total: string }>(
      `SELECT COUNT(DISTINCT we.lead_id)::text AS total
       FROM workflow_execucoes we
       JOIN leads l ON l.id = we.lead_id
       WHERE we.campanha_id = $1
         AND we.status IN ('em_andamento','aguardando')
         AND l.bounced IS NOT TRUE`,
      [CAMPANHA_MAIN]
    )
    const totalRestantes = Number(restantesRes.rows[0]?.total ?? 0)
    console.log(`  → ${totalRestantes} leads elegíveis restantes na campanha principal (já sem os Habib's).`)

    if (real) {
      await c.query(`UPDATE campanhas SET dry_run=false WHERE id=$1`, [CAMPANHA_MAIN])
      console.log(`  ✔ Campanha principal: dry_run=false (${new Date().toISOString()}) — envio REAL liberado`)
    } else {
      console.log('  ○ Campanha principal: dry_run seria liberado para FALSE (envio real) — não alterado em ensaio')
    }

    // ── Passo 3: Relatório final ──────────────────────────────────────────
    console.log('\n[Passo 3] Relatório final — counts reais:')

    const finalRes = await c.query<{ nome: string; dry_run: boolean; leads_ativos: string }>(
      `SELECT camp.nome, camp.dry_run,
              COUNT(DISTINCT we.lead_id)::text AS leads_ativos
       FROM campanhas camp
       LEFT JOIN workflow_execucoes we ON we.campanha_id = camp.id
           AND we.status IN ('em_andamento','aguardando')
       WHERE camp.organizacao_id = $1
         AND camp.nome IN (
           'Reativação de clientes',
           $2, $3
         )
       GROUP BY camp.id, camp.nome, camp.dry_run`,
      [ORG, "Reativação — Lote Habib's Piloto", "Reativação — Lote Habib's (aguardando)"]
    )

    // Guard RFID — verifica que motor não está em ensaio inesperado
    const guardRes = await c.query<{ modo_ensaio: string }>(
      `SELECT configuracoes->>'modo_ensaio' AS modo_ensaio
       FROM organizacoes WHERE id=$1`,
      [ORG]
    )
    const modoEnsaio = guardRes.rows[0]?.modo_ensaio

    console.log('\n  Campanhas afetadas:')
    for (const r of finalRes.rows) {
      console.log(`    • "${r.nome}"`)
      console.log(`        dry_run      : ${r.dry_run}`)
      console.log(`        leads ativos : ${r.leads_ativos}`)
    }
    console.log(`\n  Guard RFID (modo_ensaio na org): ${modoEnsaio ?? 'não definido (MODO_ENSAIO controlado por env)'}`)

    console.log('\n══════════════════════════════════════════════════════════')
    console.log(real ? 'CONCLUÍDO. Resumo:' : 'ENSAIO CONCLUÍDO — nada foi gravado. Resumo do que faria:')
    console.log(`  Campanha principal (leads limpos)  : dry_run=FALSE → ${totalRestantes} leads elegíveis`)
    console.log(`  Lote Habib's Piloto (${N_PILOTO})           : dry_run=FALSE → ${inscritosPiloto} leads`)
    console.log(`  Lote Habib's aguardando            : dry_run=TRUE  → ${inscritosAguardando} leads`)
    if (!real) console.log('\n  Para gravar: npx tsx scripts/liberacao-dividida-habibs.ts --confirmar')
    console.log('══════════════════════════════════════════════════════════')
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
