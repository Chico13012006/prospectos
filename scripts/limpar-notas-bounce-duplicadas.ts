/**
 * Limpa as notas de bounce duplicadas geradas pelo loop corrigido em c288687.
 *
 * Antes da correção, `tratarBounce` reescrevia a nota a cada passada do monitor
 * (a cada 120s), acumulando milhares de linhas idênticas por lead. Este script
 * apaga as repetições e PRESERVA A PRIMEIRA nota de cada lead — o registro de
 * que o bounce aconteceu continua no histórico.
 *
 * Só toca em interações cuja descrição começa com o texto da nota de bounce;
 * nenhuma outra interação é lida para escrita. Opera org por org, com
 * `organizacao_id` explícito no WHERE (interno e externo).
 *
 * ENSAIO por padrão: sem `--confirmar`, apenas relata o que apagaria.
 *
 * Uso:
 *   npx tsx scripts/limpar-notas-bounce-duplicadas.ts              (ensaio)
 *   npx tsx scripts/limpar-notas-bounce-duplicadas.ts --confirmar  (apaga)
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

// Prefixo exato gravado por tratarBounce (lib/engine/flows/detectarResposta.ts).
const PREFIXO = 'Bounce SMTP detectado%'
// O loop rodou ~4 dias a 3 notas/2min. Acima disto algo está diferente do
// esperado e o script para para revisão humana.
const LIMITE = 50_000
const LOTE = 1_000

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', grn: '\x1b[32m', yel: '\x1b[33m' }

type Org = { id: string; nome: string; notas: number; leads: number }

async function levantar(c: pg.Client): Promise<Org[]> {
  const r = await c.query<{ id: string; nome: string; n: string; leads: string }>(
    `SELECT i.organizacao_id AS id, o.nome, COUNT(*)::text AS n,
            COUNT(DISTINCT i.lead_id)::text AS leads
       FROM interacoes i
       JOIN organizacoes o ON o.id = i.organizacao_id
      WHERE i.descricao LIKE $1
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC`,
    [PREFIXO]
  )
  return r.rows.map((x) => ({ id: x.id, nome: x.nome, notas: Number(x.n), leads: Number(x.leads) }))
}

/** Apaga em lotes as duplicatas de UMA organização. Retorna quantas saíram. */
async function limparOrg(c: pg.Client, orgId: string): Promise<number> {
  let total = 0
  for (;;) {
    const r = await c.query(
      `DELETE FROM interacoes
        WHERE organizacao_id = $1
          AND id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY created_at ASC) AS rn
                FROM interacoes
               WHERE organizacao_id = $1 AND descricao LIKE $2
            ) ranked
            WHERE ranked.rn > 1
            LIMIT $3
          )`,
      [orgId, PREFIXO, LOTE]
    )
    const n = r.rowCount ?? 0
    total += n
    if (n > 0) process.stdout.write(`\r      apagadas ${total}...`)
    if (n < LOTE) break
  }
  if (total > 0) process.stdout.write('\r' + ' '.repeat(40) + '\r')
  return total
}

async function main() {
  const real = anunciarModo({
    nome: 'LIMPEZA — notas de bounce duplicadas',
    alvo: 'todas as organizações com notas duplicadas',
    efeitos: [
      'apaga de `interacoes` as notas "Bounce SMTP detectado…" repetidas',
      'PRESERVA a primeira nota de cada lead (o bounce continua registrado)',
      'não toca em nenhuma outra interação, nem no lead em si',
    ],
  })

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const antes = await levantar(c)
    if (antes.length === 0) {
      console.log(`\n${C.grn}Nenhuma nota de bounce encontrada — nada a fazer.${C.r}`)
      return
    }

    const totalNotas = antes.reduce((s, o) => s + o.notas, 0)
    const totalLeads = antes.reduce((s, o) => s + o.leads, 0)
    limiteSeguranca(totalNotas, LIMITE, 'notas de bounce')

    console.log(`\n${C.b}Situação atual${C.r}`)
    for (const o of antes) {
      console.log(`  • ${o.nome}: ${o.notas} notas em ${o.leads} leads  ${C.dim}(${o.id})${C.r}`)
    }
    console.log(
      `\n  ${C.b}${totalNotas}${C.r} notas → preservar ${C.grn}${totalLeads}${C.r} ` +
        `(a primeira de cada lead), apagar ${C.yel}${totalNotas - totalLeads}${C.r}`
    )

    if (!real) {
      console.log(`\n${C.dim}ENSAIO — nada foi apagado.`)
      console.log(`Para aplicar: npx tsx scripts/limpar-notas-bounce-duplicadas.ts --confirmar${C.r}`)
      return
    }

    console.log(`\n${C.b}Aplicando${C.r}`)
    let apagadas = 0
    for (const o of antes) {
      console.log(`  • ${o.nome}`)
      await c.query('BEGIN')
      try {
        const n = await limparOrg(c, o.id)
        await c.query('COMMIT')
        apagadas += n
        console.log(`      ${C.grn}✔${C.r} ${n} apagadas, ${o.leads} preservadas`)
      } catch (e) {
        await c.query('ROLLBACK')
        throw e
      }
    }

    // Conferência pós-limpeza: releva o estado real, não o esperado.
    const depois = await levantar(c)
    const restantes = depois.reduce((s, o) => s + o.notas, 0)
    const outras = await c.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM interacoes WHERE descricao NOT LIKE $1`, [PREFIXO]
    )

    console.log(`\n${C.b}Conferência${C.r}`)
    console.log(`  apagadas               : ${apagadas}`)
    console.log(`  notas de bounce agora  : ${restantes} ${restantes === totalLeads ? C.grn + '(uma por lead ✔)' + C.r : C.yel + '(esperado ' + totalLeads + ')' + C.r}`)
    console.log(`  demais interações      : ${outras.rows[0].n} ${C.dim}(intocadas)${C.r}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
