/**
 * Auditoria READ-ONLY do follow-up do motor. Não escreve nada. Responde:
 *   - quantos leads são owner='engine' (universo que o motor toca);
 *   - quantos desses estão "vencidos" (proxima_acao_data <= agora) = elegíveis;
 *   - histórico de follow-ups da IA (interacoes tipo='follow_up', origem_acao=
 *     'ia'): total, últimos registros e contagem por dia — pra ver SE/QUANDO um
 *     disparo rodou. (O banco NÃO carimba MODO_ENSAIO, então isto mede tentativas
 *     de envio, não distingue ensaio de real por si só.)
 *
 *   npx tsx scripts/engine-followup-auditoria.ts
 */
import fs from 'node:fs'
import path from 'node:path'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
carregarEnvLocal()

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', yel: '\x1b[33m', r: '\x1b[0m' }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const db = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })
  const agora = new Date().toISOString()

  console.log(`\n${C.b}== Auditoria follow-up (READ-ONLY) ==${C.r}`)
  console.log(`${C.dim}MODO_ENSAIO(.env.local)=${process.env.MODO_ENSAIO}  agora=${agora}${C.r}\n`)

  // 1) leads por owner
  console.log(`${C.b}[1] leads por owner (trava do motor)${C.r}`)
  for (const owner of ['engine', 'n8n']) {
    const r = await db.from('leads').select('id', { count: 'exact', head: true }).eq('owner', owner)
    console.log(`     owner='${owner}': ${r.count ?? '?'}`)
  }
  const nulos = await db.from('leads').select('id', { count: 'exact', head: true }).is('owner', null)
  if ((nulos.count ?? 0) > 0) console.log(`     owner=NULL: ${nulos.count}`)

  // 2) engine "vencidos" (elegíveis a follow-up agora): owner=engine + proxima_acao_data<=agora
  console.log(`\n${C.b}[2] engine com follow-up VENCIDO (proxima_acao_data <= agora)${C.r}`)
  const vencidos = await db.from('leads')
    .select('id, empresa, estagio, followups_enviados, proxima_acao, proxima_acao_data', { count: 'exact' })
    .eq('owner', 'engine')
    .lte('proxima_acao_data', agora)
    .order('proxima_acao_data', { ascending: true })
    .limit(20)
  console.log(`     elegíveis (amostra até 20 de ${vencidos.count ?? 0}):`)
  for (const l of vencidos.data ?? [])
    console.log(`       ${l.empresa} | estagio=${l.estagio} | fups=${l.followups_enviados} | prox=${l.proxima_acao_data}`)
  if ((vencidos.count ?? 0) === 0) console.log(`     ${C.grn}nenhum — um disparo agora enviaria 0.${C.r}`)

  // 3) histórico de follow-ups da IA
  console.log(`\n${C.b}[3] interacoes follow_up (origem_acao='ia')${C.r}`)
  const tot = await db.from('interacoes').select('id', { count: 'exact', head: true })
    .eq('tipo', 'follow_up').eq('origem_acao', 'ia')
  console.log(`     total histórico: ${tot.count ?? 0}`)
  const ultimos = await db.from('interacoes')
    .select('created_at, lead_id, descricao')
    .eq('tipo', 'follow_up').eq('origem_acao', 'ia')
    .order('created_at', { ascending: false })
    .limit(15)
  console.log(`     últimos ${ultimos.data?.length ?? 0}:`)
  for (const it of ultimos.data ?? []) {
    const assunto = String(it.descricao ?? '').replace(/\*\*/g, '').split('\n')[0].slice(0, 50)
    console.log(`       ${it.created_at}  lead=${String(it.lead_id).slice(0, 8)}  ${assunto}`)
  }
  // agrupamento por dia (dos últimos 200)
  const amostra = await db.from('interacoes').select('created_at')
    .eq('tipo', 'follow_up').eq('origem_acao', 'ia')
    .order('created_at', { ascending: false }).limit(200)
  const porDia = new Map<string, number>()
  for (const it of amostra.data ?? []) {
    const dia = String(it.created_at).slice(0, 10)
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1)
  }
  console.log(`\n${C.b}[4] follow_up(ia) por dia (últimos 200 registros)${C.r}`)
  for (const [dia, n] of [...porDia.entries()].sort().reverse()) console.log(`     ${dia}: ${n}`)
  if (porDia.size === 0) console.log(`     ${C.yel}nenhum follow-up da IA registrado ainda.${C.r}`)

  console.log(`\n${C.dim}(read-only — nada foi alterado)${C.r}\n`)
}
main().catch((e) => { console.error('erro:', e); process.exit(1) })
