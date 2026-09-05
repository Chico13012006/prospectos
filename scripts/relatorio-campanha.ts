/**
 * Relatório de campanha — SOMENTE LEITURA.
 *
 * Responde "o que de fato aconteceu depois que o dry_run foi liberado":
 * execuções por status, e-mails enviados, respostas, bounces, opt-outs e
 * leads parados com verificação vencida.
 *
 * Atribuição por campanha: `interacoes` NÃO tem `campanha_id` — o vínculo é
 * reconstruído por `workflow_execucoes.lead_id`. Um lead que passou por mais
 * de uma campanha conta nas duas; a coluna de leads ambíguos mede esse risco.
 *
 * Uso:
 *   npx tsx scripts/relatorio-campanha.ts
 *   npx tsx scripts/relatorio-campanha.ts --org <uuid>
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG_PADRAO = '03097614-9fd5-4491-a91c-589f84461683' // LAUDO DE BRINQUEDOS
const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', yel: '\x1b[33m', red: '\x1b[31m', grn: '\x1b[32m', cia: '\x1b[36m' }

function orgAlvo(): string {
  const i = process.argv.indexOf('--org')
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : ORG_PADRAO
}

function titulo(t: string) {
  console.log(`\n${C.b}${C.cia}${t}${C.r}`)
  console.log(C.dim + '─'.repeat(74) + C.r)
}

async function main() {
  const ORG = orgAlvo()
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const orgRes = await c.query<{ nome: string }>(`SELECT nome FROM organizacoes WHERE id=$1`, [ORG])
    if (orgRes.rowCount === 0) throw new Error(`Organização ${ORG} não encontrada.`)

    console.log('══════════════════════════════════════════════════════════════════════════')
    console.log(`${C.b}RELATÓRIO DE CAMPANHAS${C.r} — ${orgRes.rows[0].nome}`)
    console.log(`${C.dim}org ${ORG} · gerado em ${new Date().toISOString()} · somente leitura${C.r}`)
    console.log('══════════════════════════════════════════════════════════════════════════')

    // ── 1. Campanhas e trava de envio ───────────────────────────────────────
    titulo('1. Campanhas — status e trava de envio')
    const camps = await c.query<{
      id: string; nome: string; status: string; dry_run: boolean
      iniciada_em: string | null; leads: string
    }>(
      `SELECT camp.id, camp.nome, camp.status, camp.dry_run, camp.iniciada_em::text,
              COUNT(DISTINCT we.lead_id)::text AS leads
         FROM campanhas camp
         LEFT JOIN workflow_execucoes we ON we.campanha_id = camp.id
        WHERE camp.organizacao_id = $1
        GROUP BY camp.id
        ORDER BY camp.criado_em`,
      [ORG]
    )
    if (camps.rowCount === 0) console.log(`  ${C.dim}nenhuma campanha nesta organização.${C.r}`)
    for (const r of camps.rows) {
      const trava = r.dry_run
        ? `${C.grn}dry_run=TRUE (não envia)${C.r}`
        : `${C.red}${C.b}dry_run=FALSE (ENVIO REAL)${C.r}`
      console.log(`  • ${C.b}${r.nome}${C.r}`)
      console.log(`      status ${r.status} · ${trava} · ${r.leads} leads vinculados`)
      console.log(`      ${C.dim}id ${r.id} · iniciada ${r.iniciada_em ?? '—'}${C.r}`)
    }

    // ── 2. Execuções por campanha × status ──────────────────────────────────
    titulo('2. Execuções por campanha × status')
    const execs = await c.query<{ nome: string; status: string; n: string }>(
      `SELECT COALESCE(camp.nome, '(sem campanha)') AS nome, we.status, COUNT(*)::text AS n
         FROM workflow_execucoes we
         LEFT JOIN campanhas camp ON camp.id = we.campanha_id
        WHERE we.organizacao_id = $1
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [ORG]
    )
    if (execs.rowCount === 0) console.log(`  ${C.dim}nenhuma execução.${C.r}`)
    let nomeAtual = ''
    for (const r of execs.rows) {
      if (r.nome !== nomeAtual) { console.log(`  • ${C.b}${r.nome}${C.r}`); nomeAtual = r.nome }
      console.log(`      ${r.status.padEnd(14)} ${r.n}`)
    }

    // ── 3. Eventos de execução ──────────────────────────────────────────────
    titulo('3. Eventos de execução por campanha (o que o motor realmente fez)')
    const evs = await c.query<{ nome: string; tipo: string; n: string; ultimo: string }>(
      `SELECT COALESCE(camp.nome, '(sem campanha)') AS nome, ev.tipo, COUNT(*)::text AS n,
              MAX(ev.criado_em)::text AS ultimo
         FROM workflow_execucao_eventos ev
         JOIN workflow_execucoes we ON we.id = ev.execucao_id
         LEFT JOIN campanhas camp ON camp.id = we.campanha_id
        WHERE ev.organizacao_id = $1
        GROUP BY 1, 2
        ORDER BY 1, COUNT(*) DESC`,
      [ORG]
    )
    if (evs.rowCount === 0) console.log(`  ${C.dim}nenhum evento registrado.${C.r}`)
    nomeAtual = ''
    for (const r of evs.rows) {
      if (r.nome !== nomeAtual) { console.log(`  • ${C.b}${r.nome}${C.r}`); nomeAtual = r.nome }
      const destaque = r.tipo === 'erro' ? C.red : r.tipo === 'email_enviado' ? C.yel : ''
      console.log(`      ${destaque}${r.tipo.padEnd(24)}${C.r} ${r.n.padStart(5)}   ${C.dim}último: ${r.ultimo}${C.r}`)
    }

    // ── 4. Interações de e-mail atribuídas por campanha ─────────────────────
    titulo('4. E-mails e respostas (atribuição via lead → execução)')
    const inter = await c.query<{ nome: string; tipo: string; n: string; ultimo: string }>(
      `SELECT COALESCE(camp.nome, '(sem campanha)') AS nome, i.tipo, COUNT(*)::text AS n,
              MAX(i.created_at)::text AS ultimo
         FROM interacoes i
         LEFT JOIN LATERAL (
           SELECT we.campanha_id FROM workflow_execucoes we
            WHERE we.lead_id = i.lead_id AND we.campanha_id IS NOT NULL
            ORDER BY we.iniciado_em DESC LIMIT 1
         ) vinculo ON TRUE
         LEFT JOIN campanhas camp ON camp.id = vinculo.campanha_id
        WHERE i.organizacao_id = $1 AND i.canal = 'email'
        GROUP BY 1, 2
        ORDER BY 1, COUNT(*) DESC`,
      [ORG]
    )
    if (inter.rowCount === 0) console.log(`  ${C.dim}nenhuma interação de e-mail.${C.r}`)
    nomeAtual = ''
    for (const r of inter.rows) {
      if (r.nome !== nomeAtual) { console.log(`  • ${C.b}${r.nome}${C.r}`); nomeAtual = r.nome }
      const destaque = r.tipo === 'resposta' ? C.grn : ''
      console.log(`      ${destaque}${r.tipo.padEnd(24)}${C.r} ${r.n.padStart(5)}   ${C.dim}último: ${r.ultimo}${C.r}`)
    }

    // Leads em mais de uma campanha — mede o risco da atribuição acima.
    const ambiguos = await c.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT lead_id FROM workflow_execucoes
          WHERE organizacao_id = $1 AND campanha_id IS NOT NULL
          GROUP BY lead_id HAVING COUNT(DISTINCT campanha_id) > 1
       ) x`,
      [ORG]
    )
    const nAmb = Number(ambiguos.rows[0]?.n ?? 0)
    console.log(
      nAmb > 0
        ? `\n  ${C.yel}⚠ ${nAmb} leads passaram por mais de uma campanha — a atribuição acima os conta na mais recente.${C.r}`
        : `\n  ${C.dim}Nenhum lead em mais de uma campanha: atribuição sem ambiguidade.${C.r}`
    )

    // ── 5. Saúde da base ────────────────────────────────────────────────────
    titulo('5. Saúde da base (org inteira)')
    const saude = await c.query<{
      total: string; com_email: string; bounced: string; optout: string; perdidos: string
    }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE contato_email IS NOT NULL AND contato_email <> '')::text AS com_email,
              COUNT(*) FILTER (WHERE bounced IS TRUE)::text AS bounced,
              COUNT(*) FILTER (WHERE optout IS TRUE)::text AS optout,
              COUNT(*) FILTER (WHERE perdido IS TRUE)::text AS perdidos
         FROM leads WHERE organizacao_id = $1`,
      [ORG]
    )
    const s = saude.rows[0]
    console.log(`  leads na organização : ${s.total}`)
    console.log(`  com e-mail           : ${s.com_email}`)
    console.log(`  ${Number(s.bounced) > 0 ? C.red : ''}bounced              : ${s.bounced}${C.r}`)
    console.log(`  opt-out              : ${s.optout}`)
    console.log(`  perdidos             : ${s.perdidos}`)

    // ── 6. Execuções paradas ────────────────────────────────────────────────
    titulo('6. Execuções com verificação vencida (motor deveria ter avançado)')
    const travadas = await c.query<{ nome: string; n: string; mais_antiga: string }>(
      `SELECT COALESCE(camp.nome, '(sem campanha)') AS nome, COUNT(*)::text AS n,
              MIN(we.proxima_verificacao_em)::text AS mais_antiga
         FROM workflow_execucoes we
         LEFT JOIN campanhas camp ON camp.id = we.campanha_id
        WHERE we.organizacao_id = $1
          AND we.status IN ('em_andamento','aguardando')
          AND we.proxima_verificacao_em IS NOT NULL
          AND we.proxima_verificacao_em < now()
        GROUP BY 1 ORDER BY COUNT(*) DESC`,
      [ORG]
    )
    if (travadas.rowCount === 0) {
      console.log(`  ${C.grn}nenhuma execução vencida — o motor está em dia.${C.r}`)
    } else {
      for (const r of travadas.rows) {
        console.log(`  ${C.yel}• ${r.nome}: ${r.n} vencidas${C.r} ${C.dim}(mais antiga: ${r.mais_antiga})${C.r}`)
      }
    }

    // ── 7. Últimas respostas ────────────────────────────────────────────────
    titulo('7. Últimas respostas recebidas')
    const respostas = await c.query<{ empresa: string; contato: string; quando: string; descricao: string }>(
      `SELECT l.empresa, COALESCE(l.contato_nome, l.contato_email, '—') AS contato,
              i.created_at::text AS quando, LEFT(COALESCE(i.descricao, ''), 90) AS descricao
         FROM interacoes i JOIN leads l ON l.id = i.lead_id
        WHERE i.organizacao_id = $1 AND i.tipo = 'resposta'
        ORDER BY i.created_at DESC LIMIT 10`,
      [ORG]
    )
    if (respostas.rowCount === 0) console.log(`  ${C.dim}nenhuma resposta registrada.${C.r}`)
    for (const r of respostas.rows) {
      console.log(`  ${C.grn}•${C.r} ${r.empresa} — ${r.contato} ${C.dim}(${r.quando})${C.r}`)
      if (r.descricao) console.log(`      ${C.dim}${r.descricao}${C.r}`)
    }

    console.log('\n══════════════════════════════════════════════════════════════════════════')
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
