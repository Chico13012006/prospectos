/**
 * Diagnóstico pré-liberação — campanha Reativação de Clientes.
 * 1.2 — Contagem de domínios suspeitos (especialmente @habibs.com.br)
 * 1.3 — Status dos 4 leads do piloto (excluindo Marcelo)
 *
 * Uso: npx tsx scripts/pre-liberacao-diag.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG            = '03097614-9fd5-4491-a91c-589f84461683'
const CAMPANHA_MAIN  = 'cd82b32a-ccf2-4cda-8190-60a802b37041'
const EMAIL_MARCELO  = 'tirol@habibs.com.br'

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    console.log('══════════════════════════════════════════════════════════')
    console.log('PRÉ-LIBERAÇÃO — Diagnóstico')
    console.log('══════════════════════════════════════════════════════════')

    // ── 1.2 Total de leads elegíveis na campanha principal ─────────────────
    const totalRes = await c.query<{ total: string }>(`
      SELECT COUNT(DISTINCT we.lead_id)::text AS total
      FROM workflow_execucoes we
      JOIN leads l ON l.id = we.lead_id
      WHERE we.campanha_id = $1
        AND we.status IN ('em_andamento','aguardando')
        AND l.bounced IS NOT TRUE
    `, [CAMPANHA_MAIN])
    const total = Number(totalRes.rows[0]?.total ?? 0)

    // ── 1.2 Domínios @habibs.com.br na campanha principal ─────────────────
    const habibsRes = await c.query<{ total: string; leads: string }>(`
      SELECT
        COUNT(DISTINCT we.lead_id)::text AS total,
        string_agg(DISTINCT l.contato_email, ', ') AS leads
      FROM workflow_execucoes we
      JOIN leads l ON l.id = we.lead_id
      WHERE we.campanha_id = $1
        AND we.status IN ('em_andamento','aguardando')
        AND l.bounced IS NOT TRUE
        AND lower(l.contato_email) LIKE '%@habibs.com.br'
    `, [CAMPANHA_MAIN])
    const habibsCount = Number(habibsRes.rows[0]?.total ?? 0)
    const habibsLeads = habibsRes.rows[0]?.leads ?? '-'

    // ── 1.2 Top domínios suspeitos (nome da empresa ≠ domínio do e-mail) ──
    // Heurística: domínio do e-mail tem < 4 letras no subdomínio ou é
    // um domínio genérico de rede de franquias / grandes redes.
    const dominiosRes = await c.query<{ dominio: string; qtd: string }>(`
      SELECT
        lower(split_part(l.contato_email, '@', 2)) AS dominio,
        COUNT(*)::text AS qtd
      FROM workflow_execucoes we
      JOIN leads l ON l.id = we.lead_id
      WHERE we.campanha_id = $1
        AND we.status IN ('em_andamento','aguardando')
        AND l.bounced IS NOT TRUE
        AND l.contato_email IS NOT NULL
      GROUP BY 1
      ORDER BY 2::int DESC
      LIMIT 20
    `, [CAMPANHA_MAIN])

    console.log(`\n[1.2] DOMÍNIOS NA CAMPANHA PRINCIPAL`)
    console.log(`  Leads elegíveis (não bounced, execução ativa): ${total}`)
    console.log(`  Leads @habibs.com.br: ${habibsCount} (${total > 0 ? ((habibsCount/total)*100).toFixed(1) : '0'}%)`)
    if (habibsCount > 0) console.log(`    → e-mails: ${habibsLeads}`)
    console.log(`\n  Top 20 domínios da base:`)
    for (const r of dominiosRes.rows) {
      const pct = total > 0 ? ((Number(r.qtd)/total)*100).toFixed(1) : '0'
      console.log(`    ${String(r.qtd).padStart(3)}  (${pct.padStart(5)}%)  ${r.dominio}`)
    }

    // ── 1.3 Status dos leads do piloto ────────────────────────────────────
    const pilotoRes = await c.query<{
      lead_id: string; empresa: string; contato_nome: string; contato_email: string
      bounced: boolean; bounced_em: string | null; estagio: string; proxima_acao: string | null
      exec_status: string; passo_atual: number; ultima_interacao: string | null; tipo_interacao: string | null
    }>(`
      SELECT
        l.id AS lead_id,
        l.empresa,
        l.contato_nome,
        l.contato_email,
        l.bounced,
        l.bounced_em,
        l.estagio,
        l.proxima_acao,
        we.status AS exec_status,
        we.passo_atual,
        (SELECT descricao FROM interacoes
          WHERE lead_id = l.id ORDER BY criado_em DESC LIMIT 1) AS ultima_interacao,
        (SELECT tipo FROM interacoes
          WHERE lead_id = l.id ORDER BY criado_em DESC LIMIT 1) AS tipo_interacao
      FROM workflow_execucoes we
      JOIN leads l ON l.id = we.lead_id
      JOIN campanhas camp ON camp.id = we.campanha_id
      WHERE camp.organizacao_id = $1
        AND camp.nome = 'Reativação — Piloto'
        AND l.contato_email != $2
      ORDER BY we.iniciado_em
    `, [ORG, EMAIL_MARCELO])

    console.log(`\n[1.3] STATUS DOS OUTROS 4 LEADS DO PILOTO (excluindo Marcelo)`)
    if (pilotoRes.rows.length === 0) {
      console.log('  ⚠ Nenhum lead encontrado no piloto além do Marcelo.')
    }
    for (const r of pilotoRes.rows) {
      const bounceInfo = r.bounced ? ` ⛔ BOUNCED em ${r.bounced_em ?? '?'}` : ''
      console.log(`\n  • ${r.contato_nome ?? '-'} / ${r.empresa}`)
      console.log(`    e-mail      : ${r.contato_email}${bounceInfo}`)
      console.log(`    estágio     : ${r.estagio}`)
      console.log(`    próx. ação  : ${r.proxima_acao ?? '-'}`)
      console.log(`    exec status : ${r.exec_status}  (passo ${r.passo_atual})`)
      const inter = r.ultima_interacao ? r.ultima_interacao.slice(0, 120) : '-'
      console.log(`    última int. : [${r.tipo_interacao ?? '-'}] ${inter}`)
    }

    // ── Resumo da decisão ─────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════')
    const propHabibs = total > 0 ? habibsCount / total : 0
    if (propHabibs > 0.15) {
      console.log(`⚠  @habibs.com.br representa ${(propHabibs*100).toFixed(1)}% da base (>${15}%): REVISAR antes de liberar.`)
    } else {
      console.log(`✔  @habibs.com.br: ${habibsCount}/${total} (${(propHabibs*100).toFixed(1)}%) — dentro do limite aceitável.`)
    }
    console.log('══════════════════════════════════════════════════════════')
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
