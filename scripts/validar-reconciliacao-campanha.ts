/**
 * Validação SOMENTE-LEITURA de uma reconciliação aplicada por
 * `scripts/aplicar-reconciliacao-campanha.ts` (entrada: o backup que ele gerou).
 *
 * Verifica, com o MESMO código que a aplicação usa:
 *   1. interacoes recriadas (1 por lead, nota/email/ia, template e created_at certos)
 *   2. leads.ultimo_contato = Date do e-mail e owner='engine'
 *   3. workflow_execucoes: `SupabaseWorkflowStore.buscarExecucaoParaLead` devolve a
 *      execução concluída (é o que faz `inscreverLeadManual` responder jaInscrito)
 *   4. enrollment em dry-run: `buscarPreviaPublicoCampanha` (mesma função do wizard)
 *      + `buscarExecucaoParaLead` por elegível → quem seria NOVO envio. Nada é
 *      criado: `inscreverLeadManual` não é chamado.
 *   5. Dashboard: as mesmas consultas do GET /api/dashboard/resumo (escopo admin)
 *      + `resumirInteracoesProspeccao`, antes/depois é comparável entre execuções.
 *   6. Sem envio: campanha continua pausada/dry_run e nº de travas 'envio' não muda.
 *
 * Requer `server-only` resolvido:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/validar-reconciliacao-campanha.ts --backup <json> [--ids-saida <txt>]
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

interface Backup {
  motivo: string
  campanha: { id: string; org: string; workflow_id: string; versao_id: string; template_id: string }
  itens: { leadId: string; execucaoId: string; travaId: string; interacaoId: string; emailData: string }[]
}

const ok = (b: boolean) => (b ? 'OK ' : 'FALHA')

async function main() {
  const backupPath = arg('--backup')
  if (!backupPath) { console.error('Uso: --backup <json> [--ids-saida <txt>]'); process.exit(1) }
  const bk = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as Backup
  const { org, id: campanhaId, workflow_id: workflowId, template_id: templateId } = bk.campanha
  const leadIds = bk.itens.map((i) => i.leadId)
  const porLead = new Map(bk.itens.map((i) => [i.leadId, i]))

  const { createSupabaseAdminClient } = await import('@/lib/supabase-admin')
  const { SupabaseWorkflowStore } = await import('@/lib/workflows')
  const { buscarPreviaPublicoCampanha } = await import('@/lib/campanhas/publicoServidor')
  const { aplicarRegraPublicoPorTipo } = await import('@/lib/campanhas/configuracaoGuiada')
  const { buscarCampanha } = await import('@/lib/campanhas/repository')
  const { resumirInteracoesProspeccao } = await import('@/lib/operacao/dashboard')
  const { TIPOS_INTERACAO_ENVIO } = await import('@/lib/cadencia/classificacao')
  const admin = createSupabaseAdminClient()
  const store = new SupabaseWorkflowStore(org, admin)

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const falhas: string[] = []
  try {
    console.log(`\nVALIDAÇÃO (somente leitura) — ${bk.itens.length} lead(s) do backup ${path.basename(backupPath)}`)

    // 1) interacoes
    const inter = (await c.query(
      `select id, lead_id, tipo, canal, origem_acao, template_id, responsavel_id, created_at, left(descricao, 40) ini, motivo
         from interacoes where organizacao_id=$1 and lead_id = any($2::uuid[]) and canal='email' order by created_at`, [org, leadIds])).rows
    const interPorLead = new Map<string, typeof inter>()
    for (const r of inter) interPorLead.set(r.lead_id, [...(interPorLead.get(r.lead_id) ?? []), r])
    let interOk = 0
    for (const it of bk.itens) {
      const rows = interPorLead.get(it.leadId) ?? []
      const certa = rows.length === 1
        && rows[0].id === it.interacaoId
        && rows[0].tipo === 'nota' && rows[0].origem_acao === 'ia'
        && rows[0].template_id === templateId
        && new Date(rows[0].created_at).toISOString() === new Date(it.emailData).toISOString()
        && String(rows[0].ini).startsWith('**')
        && rows[0].motivo === bk.motivo
      if (certa) interOk += 1
      else falhas.push(`interacao lead ${it.leadId}: ${rows.length} linha(s) e-mail; ${JSON.stringify(rows.map((r) => ({ tipo: r.tipo, tpl: r.template_id === templateId, em: r.created_at })))}`)
    }
    console.log(`\n[1] interacoes ............ ${ok(interOk === bk.itens.length)} ${interOk}/${bk.itens.length} exatamente 1 nota/email/ia por lead, template e created_at = Date do e-mail`)

    // 2) leads
    const leads = (await c.query(`select id, owner, estagio, ultimo_contato, bounced, optout, perdido from leads where organizacao_id=$1 and id = any($2::uuid[])`, [org, leadIds])).rows
    let leadOk = 0
    for (const l of leads) {
      const it = porLead.get(l.id)!
      const certo = l.owner === 'engine' && l.ultimo_contato && new Date(l.ultimo_contato).toISOString() === new Date(it.emailData).toISOString()
      if (certo) leadOk += 1
      else falhas.push(`lead ${l.id}: owner=${l.owner} ultimo_contato=${l.ultimo_contato}`)
    }
    console.log(`[2] leads ................. ${ok(leadOk === bk.itens.length && leads.length === bk.itens.length)} ${leadOk}/${bk.itens.length} owner='engine' e ultimo_contato = Date do e-mail (estágios: ${[...new Set(leads.map((l) => l.estagio))].join(',')})`)

    // 3) execuções vistas pelo store real
    let execOk = 0
    for (const it of bk.itens) {
      const ex = await store.buscarExecucaoParaLead(workflowId, it.leadId)
      const eventos = Number((await c.query(`select count(*) from workflow_execucao_eventos where organizacao_id=$1 and execucao_id=$2`, [org, it.execucaoId])).rows[0].count)
      const certo = !!ex && ex.id === it.execucaoId && ex.status === 'concluido' && ex.campanha_id === campanhaId && eventos === 5
      if (certo) execOk += 1
      else falhas.push(`execucao lead ${it.leadId}: ${ex ? `${ex.id} ${ex.status} camp=${ex.campanha_id}` : 'nenhuma'} eventos=${eventos}`)
    }
    console.log(`[3] workflow_execucoes .... ${ok(execOk === bk.itens.length)} ${execOk}/${bk.itens.length} buscarExecucaoParaLead → execução concluída da campanha (id da trava) com 5 eventos → inscreverLeadManual responderia jaInscrito`)
    const travasComLead = Number((await c.query(`select count(*) from mensagens_processadas where organizacao_id=$1 and id = any($2::uuid[]) and lead_id is not null`, [org, bk.itens.map((i) => i.travaId)])).rows[0].count)
    console.log(`    mensagens_processadas ... ${ok(travasComLead === bk.itens.length)} ${travasComLead}/${bk.itens.length} travas com lead_id reassociado`)

    // 4) enrollment em dry-run (mesma prévia do wizard; nada é criado)
    const campanha = await buscarCampanha(admin, org, campanhaId)
    if (!campanha) throw new Error('campanha não encontrada')
    const previa = await buscarPreviaPublicoCampanha(admin, org, aplicarRegraPublicoPorTipo(campanha.publico, campanha.tipo), campanha.workflow_id)
    const jaInscritos: string[] = []
    const novos: string[] = []
    for (const leadId of previa.idsElegiveis) {
      const ex = await store.buscarExecucaoParaLead(campanha.workflow_id!, leadId)
      if (ex) jaInscritos.push(leadId); else novos.push(leadId)
    }
    const reconciliadosEntreNovos = leadIds.filter((id) => novos.includes(id))
    const totalLeads = Number((await c.query(`select count(*) from leads where organizacao_id=$1`, [org])).rows[0].count)
    console.log(`\n[4] enrollment dry-run .... ${ok(reconciliadosEntreNovos.length === 0)}`)
    console.log(`    leads na org ............ ${totalLeads}`)
    console.log(`    prévia do wizard ........ elegíveis=${previa.elegiveis} (selecionados=${previa.totalSelecionado}, bloqueados=${previa.bloqueados}, incompatíveis=${previa.incompativeis}, duplicados=${previa.duplicados})`)
    console.log(`    já inscritos (execução) . ${jaInscritos.length}`)
    console.log(`    NOVOS envios se ativada . ${novos.length}`)
    console.log(`    reconciliados entre NOVOS ${reconciliadosEntreNovos.length} (esperado 0)`)
    console.log(`    campanha ................ status=${campanha.status} dry_run=${campanha.dry_run} (inscrição real exige status='ativa'; envio exige dry_run=false)`)
    const idsSaida = arg('--ids-saida')
    if (idsSaida) {
      fs.writeFileSync(idsSaida, novos.join('\n') + '\n', 'utf-8')
      console.log(`    IDs dos NOVOS gravados em ${idsSaida}`)
    }

    // 5) Dashboard — mesmas consultas do GET /api/dashboard/resumo (escopo admin)
    const agora = new Date()
    const desde30 = new Date(agora.getTime() - 30 * 86_400_000)
    const desde60 = new Date(agora.getTime() - 60 * 86_400_000)
    const enviados30 = await admin.from('interacoes').select('id', { count: 'exact', head: true }).eq('organizacao_id', org)
      .in('tipo', TIPOS_INTERACAO_ENVIO).eq('canal', 'email').eq('origem_acao', 'ia').gte('created_at', desde30.toISOString())
    const contatados30 = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('organizacao_id', org).gte('ultimo_contato', desde30.toISOString())
    const metricasQ = await admin.from('interacoes')
      .select('id, lead_id, tipo, canal, origem_acao, created_at, leads!inner(id, segmento, estado, responsavel_id, responsavel_nome)')
      .eq('organizacao_id', org).in('tipo', [...TIPOS_INTERACAO_ENVIO, 'resposta']).lt('created_at', agora.toISOString())
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5000)
    const cadenciaQ = await admin.from('workflow_execucoes')
      .select('id, lead_id, iniciado_em, leads!inner(id, estagio, responsavel_id, responsavel_nome)')
      .eq('organizacao_id', org).eq('leads.organizacao_id', org).not('lead_id', 'is', null)
      .order('iniciado_em', { ascending: true }).order('id', { ascending: true }).limit(5000)
    type Row = { id: string; lead_id: string; tipo: string; canal: string | null; origem_acao: string | null; created_at: string; leads: { segmento: string | null; estado: string | null } }
    const interacoesMetricas = ((metricasQ.data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id, leadId: r.lead_id, tipo: r.tipo, canal: r.canal, origemAcao: r.origem_acao, criadaEm: r.created_at,
      segmento: r.leads?.segmento ?? null, estado: r.leads?.estado ?? null,
    }))
    type ExRow = { id: string; lead_id: string; iniciado_em: string; leads: { estagio: string | null } }
    const leadsCadencia = ((cadenciaQ.data ?? []) as unknown as ExRow[]).map((r) => ({ leadId: r.lead_id, estagio: r.leads?.estagio ?? null, inscritoEm: r.iniciado_em }))
    const m = resumirInteracoesProspeccao(interacoesMetricas, desde60, desde30, agora, leadsCadencia)
    const mensagens30 = m.series.mensagens.reduce((s, n) => s + n, 0)
    const reconciliadasNaSerie = interacoesMetricas.filter((i) => leadIds.includes(i.leadId) && i.tipo === 'nota' && i.canal === 'email' && i.origemAcao === 'ia').length
    console.log(`\n[5] Dashboard (escopo admin, mesmas consultas da rota)`)
    console.log(`    "Mensagens enviadas (30d)" ... ${enviados30.count ?? 'erro'}  ← inclui os ${reconciliadasNaSerie} reconciliados ${ok(reconciliadasNaSerie === bk.itens.length)}`)
    console.log(`    "Contatados (30d)" ........... ${contatados30.count ?? 'erro'}`)
    console.log(`    série mensagens (soma) ....... ${mensagens30}  buckets=${JSON.stringify(m.series.mensagens)}`)
    console.log(`    follow-ups ativos/retornos ... ${m.followUps.clientes}/${m.followUps.retornos} (leads em cadência via execuções: ${leadsCadencia.length})`)
    console.log(`    nichos ....................... ${m.nichos.map((n) => `${n.nome}=${n.quantidade}`).join(', ') || '-'}`)

    // 6) sem envio
    const travasEnvio = Number((await c.query(`select count(*) from mensagens_processadas where organizacao_id=$1 and resultado='envio'`, [org])).rows[0].count)
    const execAtivas = Number((await c.query(`select count(*) from workflow_execucoes where organizacao_id=$1 and campanha_id=$2 and status in ('em_andamento','aguardando')`, [org, campanhaId])).rows[0].count)
    console.log(`\n[6] sem envio real ........ ${ok(campanha.status !== 'ativa' && campanha.dry_run === true && execAtivas === 0)} travas 'envio'=${travasEnvio} (278 = nenhuma nova) · execuções ativas da campanha=${execAtivas} · este script não importa provider de e-mail`)

    if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log('  - ' + f) }
    else console.log('\nTodas as verificações passaram.')
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exit(1) })
