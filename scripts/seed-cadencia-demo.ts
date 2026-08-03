/**
 * Popula a aba "Cadência de Follow-up" distribuindo alguns leads pelas 4 colunas
 * de follow-up (1º, 2º, 3º e 4º+). Pega leads parados em `novos_leads` (owner
 * 'n8n'), move para o estágio de cadência `follow_up` e seta o cache
 * `followups_enviados` (migration 0003) para 1/2/3/4 conforme a coluna alvo.
 *
 * SEGURANÇA: mantém `owner='n8n'`, então o MOTOR (trava owner='engine') NUNCA
 * toca nesses leads — zero risco de disparo de e-mail real. É só uma população
 * VISUAL da aba Cadência. Cada lead recebe uma nota de auditoria; a mudança é
 * reversível (volta estagio->novos_leads, followups_enviados->0).
 *
 *   npx tsx scripts/seed-cadencia-demo.ts           # dry-run (lista o que faria)
 *   npx tsx scripts/seed-cadencia-demo.ts --apply    # grava
 *   npx tsx scripts/seed-cadencia-demo.ts --revert    # desfaz (usa a nota de auditoria)
 */
import { bootstrapEnv } from './_bootstrap'
bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', grn: '\x1b[32m', yel: '\x1b[33m', red: '\x1b[31m', r: '\x1b[0m' }

const ESTAGIO_ALVO = 'follow_up'
const ORIGEM = 'novos_leads'
const OWNER = 'n8n'
const NOTA_TAG = '[seed-cadencia-demo]'

// Funil: quantos leads em cada coluna da Cadência (1º..4º follow-up).
const DISTRIBUICAO: { followups: number; qtd: number }[] = [
  { followups: 1, qtd: 5 },
  { followups: 2, qtd: 4 },
  { followups: 3, qtd: 3 },
  { followups: 4, qtd: 3 },
]

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const db = createSupabaseAdminClient()

  if (revert) return doRevert(db)

  const total = DISTRIBUICAO.reduce((a, d) => a + d.qtd, 0)
  console.log(`\n${C.b}== Seed Cadência (demo) ==${C.r}`)
  console.log(`${C.dim}modo: ${apply ? C.yel + 'APPLY' + C.dim : 'DRY-RUN'}  |  alvo: ${total} leads '${ORIGEM}'->'${ESTAGIO_ALVO}' (owner='${OWNER}', fora do motor)${C.r}\n`)

  const { data: leads, error } = await db
    .from('leads')
    .select('id, empresa, estagio, owner, followups_enviados, organizacao_id')
    .eq('estagio', ORIGEM)
    .eq('owner', OWNER)
    .order('created_at', { ascending: true })
    .limit(total)
  if (error) throw error
  if (!leads || leads.length < total) {
    console.log(`${C.red}Só encontrei ${leads?.length ?? 0} leads em '${ORIGEM}' (owner='${OWNER}'); preciso de ${total}.${C.r}`)
    if (!leads?.length) return
  }

  // Fatia o lote conforme a distribuição do funil.
  const plano: { lead: (typeof leads)[number]; followups: number }[] = []
  let i = 0
  for (const d of DISTRIBUICAO) {
    for (let k = 0; k < d.qtd && i < leads.length; k++, i++) {
      plano.push({ lead: leads[i], followups: d.followups })
    }
  }

  for (const d of DISTRIBUICAO) {
    const nomes = plano.filter(p => p.followups === d.followups).map(p => p.lead.empresa)
    console.log(`${C.cyan}${C.b}${d.followups}º follow-up${C.r} (${nomes.length}):`)
    for (const n of nomes) console.log(`    • ${n}`)
  }
  console.log()

  if (!apply) {
    console.log(`${C.dim}DRY-RUN — nada gravado. Para aplicar: npx tsx scripts/seed-cadencia-demo.ts --apply${C.r}\n`)
    return
  }

  let ok = 0
  for (const { lead, followups } of plano) {
    const upd = await db
      .from('leads')
      .update({ estagio: ESTAGIO_ALVO, followups_enviados: followups })
      .eq('id', lead.id)
      .eq('estagio', ORIGEM) // trava anti-corrida
      .select('id')
    if (upd.error) { console.log(`${C.red}erro ${lead.empresa}: ${upd.error.message}${C.r}`); continue }
    if (!upd.data?.length) continue
    await db.from('interacoes').insert({
      lead_id: lead.id,
      organizacao_id: lead.organizacao_id,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `${NOTA_TAG} lead movido de '${ORIGEM}' para '${ESTAGIO_ALVO}' com followups_enviados=${followups} (população visual da aba Cadência; reversível).`,
      origem_acao: 'ia',
    })
    ok++
  }
  console.log(`${C.grn}${C.b}APLICADO${C.r} — ${ok} lead(s) distribuídos pela Cadência.\n`)
}

async function doRevert(db: any) {
  console.log(`\n${C.b}== Revert Seed Cadência ==${C.r}`)
  const { data: notas, error } = await db
    .from('interacoes')
    .select('lead_id')
    .eq('tipo', 'nota')
    .ilike('descricao', `${NOTA_TAG}%`)
  if (error) throw error
  const ids = [...new Set((notas ?? []).map((n: any) => n.lead_id))]
  if (!ids.length) { console.log(`${C.yel}Nada para reverter.${C.r}\n`); return }
  const upd = await db.from('leads')
    .update({ estagio: ORIGEM, followups_enviados: 0 })
    .in('id', ids)
    .select('id')
  if (upd.error) throw upd.error
  await db.from('interacoes').delete().ilike('descricao', `${NOTA_TAG}%`)
  console.log(`${C.grn}Revertidos ${upd.data?.length ?? 0} lead(s) para '${ORIGEM}' / fup=0.${C.r}\n`)
}

main().catch(e => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
