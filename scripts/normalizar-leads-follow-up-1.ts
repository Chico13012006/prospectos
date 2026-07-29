/**
 * Normaliza os leads presos em estagio='follow_up_1' (vocabulário de TEMPLATE
 * que vazou pro campo leads.estagio) de volta para 'follow_up' — o estágio de
 * cadência que o motor reconhece (ESTAGIOS_EM_CADENCIA). Sem isso, o motor
 * NUNCA os pega (leadsParaFollowup filtra por estágio de cadência) e eles ficam
 * parados para sempre, por mais vencidos que estejam.
 *
 * DRY-RUN por padrão: só LISTA o que faria e mostra o PREVIEW do e-mail (assunto
 * + corpo) que o motor enviaria no próximo follow-up de cada lead. NÃO grava,
 * NÃO envia e-mail.
 *
 *   npx tsx scripts/normalizar-leads-follow-up-1.ts            # dry-run (revisar)
 *   npx tsx scripts/normalizar-leads-follow-up-1.ts --apply    # grava a mudança
 *
 * O --apply só altera o campo `estagio` (follow_up_1 -> follow_up) e registra
 * uma nota de auditoria por lead. Quem envia o e-mail é o CRON depois — este
 * script nunca envia nada. Com o cron Enabled + MODO_ENSAIO=false, o próximo
 * disparo mandará o follow-up nº 1 REAL para estes leads: por isso reveja o
 * preview antes de aplicar.
 */
import fs from 'node:fs'
import path from 'node:path'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) throw new Error('.env.local não encontrado')
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
carregarEnvLocal()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', grn: '\x1b[32m', yel: '\x1b[33m', red: '\x1b[31m', r: '\x1b[0m' }

const ESTAGIO_ORIGEM = 'follow_up_1'
const ESTAGIO_ALVO = 'follow_up'
const OWNER_ESPERADO = 'engine'
const LIMITE_SEGURANCA = 10 // recusa aplicar se aparecer muito mais lead que o esperado

async function main() {
  const apply = process.argv.includes('--apply')
  const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
  const { criarMotor } = await import('../lib/engine')
  const { ORG_PADRAO_ID } = await import('../lib/engine/config')
  const { montarEmail } = await import('../lib/engine/mensagem')

  const db = createSupabaseAdminClient()

  console.log(`\n${C.b}== Normalização de leads '${ESTAGIO_ORIGEM}' -> '${ESTAGIO_ALVO}' ==${C.r}`)
  console.log(`${C.dim}modo: ${apply ? C.yel + 'APPLY (grava)' + C.dim : 'DRY-RUN (não grava)'}  |  MODO_ENSAIO=${process.env.MODO_ENSAIO}${C.r}\n`)

  // Alvo estrito: estagio de origem. (Confere owner por lead abaixo.)
  const { data: leads, error } = await db
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)')
    .eq('estagio', ESTAGIO_ORIGEM)
    .order('created_at', { ascending: true })
  if (error) throw new Error('erro lendo leads: ' + error.message)

  if (!leads || leads.length === 0) {
    console.log(`${C.grn}Nada a fazer — nenhum lead em '${ESTAGIO_ORIGEM}'.${C.r}\n`)
    return
  }

  // Guardrail: só age em owner='engine'. Um lead 'follow_up_1' com outro owner
  // não deveria existir; se aparecer, alerta e NÃO toca nele.
  const alvo = leads.filter((l) => l.owner === OWNER_ESPERADO)
  const foraOwner = leads.filter((l) => l.owner !== OWNER_ESPERADO)
  if (foraOwner.length) {
    console.log(`${C.yel}! ${foraOwner.length} lead(s) em '${ESTAGIO_ORIGEM}' com owner != '${OWNER_ESPERADO}' — ignorados:${C.r}`)
    for (const l of foraOwner) console.log(`    ${l.empresa} (owner=${l.owner})`)
    console.log()
  }

  const store = criarMotor(ORG_PADRAO_ID).store

  console.log(`${C.b}${alvo.length} lead(s) a normalizar:${C.r}\n`)
  const ids: string[] = []
  for (const lead of alvo) {
    ids.push(lead.id as string)
    // nº do próximo follow-up = follow-ups já registrados + 1 (mesma conta do motor)
    const jaEnviados = await store.contarInteracoes(lead.id as string, 'follow_up')
    const numero = jaEnviados + 1
    let preview: { assunto: string; corpo: string }
    try {
      preview = await montarEmail(store, lead as never, { tipo: 'follow_up', numero })
    } catch (e) {
      preview = { assunto: `${C.red}(sem template: ${e instanceof Error ? e.message : e})${C.r}`, corpo: '' }
    }

    console.log(`${C.cyan}${C.b}• ${lead.empresa}${C.r}`)
    console.log(`    id=${lead.id}`)
    console.log(`    para: ${lead.contato_nome ?? '(sem nome)'} <${lead.contato_email ?? '(sem e-mail)'}>`)
    console.log(`    estagio: ${C.yel}${lead.estagio}${C.r} -> ${C.grn}${ESTAGIO_ALVO}${C.r}`)
    console.log(`    follow-ups já enviados: ${jaEnviados}  ->  próximo seria o nº ${numero}`)
    console.log(`    proxima_acao_data: ${lead.proxima_acao_data} ${new Date(lead.proxima_acao_data as string) <= new Date() ? C.dim + '(vencido: elegível no próximo cron)' + C.r : ''}`)
    console.log(`    ${C.b}assunto:${C.r} ${preview.assunto}`)
    console.log(`    ${C.b}corpo:${C.r}`)
    for (const linha of String(preview.corpo).split('\n')) console.log(`      ${linha}`)
    console.log()
  }

  if (!apply) {
    console.log(`${C.dim}DRY-RUN — nada foi gravado. Revise os previews acima.${C.r}`)
    console.log(`${C.dim}Para aplicar:  npx tsx scripts/normalizar-leads-follow-up-1.ts --apply${C.r}\n`)
    return
  }

  // ---- APPLY ----
  if (ids.length > LIMITE_SEGURANCA) {
    console.log(`${C.red}ABORTADO: ${ids.length} leads excede o limite de segurança (${LIMITE_SEGURANCA}). Revise antes.${C.r}\n`)
    process.exit(1)
  }
  // Dupla-trava: só atualiza quem AINDA está em follow_up_1 (evita corrida) e é engine.
  const upd = await db
    .from('leads')
    .update({ estagio: ESTAGIO_ALVO })
    .in('id', ids)
    .eq('estagio', ESTAGIO_ORIGEM)
    .eq('owner', OWNER_ESPERADO)
    .select('id, empresa, organizacao_id')
  if (upd.error) throw new Error('erro no update: ' + upd.error.message)

  // Nota de auditoria por lead (rastro da manutenção). Org explícita (service_role).
  for (const l of upd.data ?? []) {
    await db.from('interacoes').insert({
      lead_id: l.id,
      organizacao_id: l.organizacao_id,
      tipo: 'nota',
      canal: 'sistema',
      descricao: `Estágio normalizado de '${ESTAGIO_ORIGEM}' para '${ESTAGIO_ALVO}' (manutenção: lead estava invisível ao motor por estágio fora da cadência).`,
      origem_acao: 'ia',
    })
  }

  console.log(`${C.grn}${C.b}APLICADO${C.r} — ${upd.data?.length ?? 0} lead(s) normalizado(s) para '${ESTAGIO_ALVO}' + nota de auditoria.`)
  console.log(`${C.yel}Atenção: no próximo cron (Enabled + MODO_ENSAIO=false) estes leads recebem follow-up REAL.${C.r}\n`)
}

main().catch((e) => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
