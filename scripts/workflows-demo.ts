/**
 * Demo end-to-end do motor de workflows (Fase 3) contra o banco REAL, EFÊMERO e
 * em modo SIMULAÇÃO (não envia e-mail nem grava interação real). Prova o aceite:
 *
 *   gatilho "campo de data vence em N dias"  ->  esperar  ->  checar resposta
 *   ->  ação A (tarefa, se respondeu) OU ação B (e-mail, se não respondeu)
 *
 * com espera PERSISTIDA sobrevivendo a "reinício" (entre o tick 1 e o tick 2 não
 * há estado em memória — só o que está no banco). 2 leads no cenário: um que
 * "respondeu" (vai pro ramo A) e um que não (ramo B).
 *
 *   npx tsx scripts/workflows-demo.ts
 *
 * Requer as migrations 0006/0007/0008 aplicadas. Limpa tudo no fim.
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
// Cinto de segurança extra: mesmo fora do modo simular, nada deve sair.
process.env.MODO_ENSAIO = 'true'

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const info = (s: string) => console.log(`${C.dim}·${C.r} ${s}`)
const RUN = Date.now().toString(36)
let falhas = 0
const checa = (c: boolean, d: string) => { c ? ok(d) : (no(d), falhas++) }

const DEF = {
  gatilho: { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 1 } },
  condicoes: [],
  acoes: [
    { tipo: 'esperar', config: { dias: 3 } },
    {
      tipo: 'ramificar',
      config: {
        condicao: { tipo: 'lead_respondeu', config: { respondeu: true } },
        entao: [{ tipo: 'criar_tarefa', config: { titulo: 'Ligar — o lead respondeu' } }],
        senao: [{ tipo: 'enviar_email', config: { template: 'follow_up_1' } }],
      },
    },
  ],
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { criarWorkflowStore, criarWorkflow, publicar, registrarBlocosPadrao, AmbienteSupabase, processarTudo } =
    await import('../lib/workflows')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const db = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Demo motor de workflows (Fase 3) — simulação, run=${RUN} ==${C.r}\n`)
  const criado = { org: '', leads: [] as string[], template: 0, workflow: '' }

  try {
    // pré-checagem: schema da Fase 2 aplicado?
    const probe = await db.from('workflow_execucoes').select('id').limit(1)
    if (probe.error) { no(`workflow_execucoes inacessível — migration 0008 aplicada? (${probe.error.message})`); process.exit(1) }

    // org de teste
    const { data: org } = await db.from('organizacoes').insert({ nome: `Demo ${RUN}`, slug: `demo-${RUN}` }).select('id').single()
    criado.org = org!.id

    // template genérico follow_up_1 (para a ação enviar_email do ramo B)
    const tpl = await db.from('templates').insert({
      organizacao_id: org!.id, nome: `Demo follow_up_1 ${RUN}`, canal: 'email', tipo: 'follow_up_1', ativo: true, nicho: null,
      assunto: 'Re: {empresa}', corpo: 'Olá {nome}, tudo bem? Retomando nosso contato sobre a {empresa}.',
    }).select('id')
    if (tpl.error) throw new Error('template: ' + tpl.error.message)
    criado.template = tpl.data?.length ?? 0

    // molde de lead real (herda NOT NULL) → 2 leads: A respondeu, B não.
    const amostra = await db.from('leads').select('*').limit(1)
    if (amostra.error || !amostra.data?.length) throw new Error('sem lead-amostra')
    const molde = amostra.data[0] as Record<string, unknown>
    const agora = new Date().toISOString()
    async function novoLead(tag: string) {
      const l: Record<string, unknown> = { ...molde }
      delete l.id; delete l.created_at; delete l.updated_at; delete (l as { usuarios?: unknown }).usuarios
      l.organizacao_id = org!.id
      l.owner = 'n8n'; l.segmento = null
      l.empresa = `WF-DEMO ${tag} ${RUN}`
      l.hubspot_id = `wf-demo-${tag}-${RUN}`; l.contato_email = `wf-${tag}-${RUN}@iso.test`; l.contato_nome = `Contato ${tag}`
      l.responsavel_id = null; l.responsavel_nome = null
      l.proxima_acao = 'follow_up'; l.proxima_acao_data = agora // vencido → gatilho pega
      const r = await db.from('leads').insert(l).select('id').single()
      if (r.error) throw new Error(`lead ${tag}: ${r.error.message}`)
      criado.leads.push(r.data.id as string)
      return r.data.id as string
    }
    const leadA = await novoLead('A')
    const leadB = await novoLead('B')
    // lead A "respondeu": interação tipo='resposta' (o mesmo sinal do detectarResposta)
    // origem_acao='ia' bate com o que o detectarResposta grava — é o sinal que
    // contarInteracoes(...,'resposta') conta (a condição lead_respondeu usa isso).
    const insResp = await db.from('interacoes').insert({
      organizacao_id: org!.id, lead_id: leadA, tipo: 'resposta', canal: 'email',
      descricao: 'Tenho interesse, pode me ligar.', origem_acao: 'ia',
    })
    if (insResp.error) throw new Error('interacao resposta: ' + insResp.error.message)
    info(`org=${org!.id}  leadA(respondeu)=${leadA}  leadB=${leadB}`)

    // cria + publica o workflow
    const store = criarWorkflowStore(org!.id, db)
    const wf = await criarWorkflow(store, { nome: `Reativação ${RUN}`, definicao: DEF })
    criado.workflow = wf.id
    const { versao } = await publicar(store, wf.id, null)
    checa(versao.numero === 1, 'workflow publicado (versão nº 1).')

    const registro = registrarBlocosPadrao()
    const ambiente = new AmbienteSupabase(org!.id, { simular: true, client: db })

    // --- TICK 1 (agora): inscreve os 2 leads, roda até a espera ---
    const r1 = await processarTudo(store, registro, ambiente, agora)
    checa(r1.inscritos === 2, `tick 1: inscreveu os 2 leads (inscritos=${r1.inscritos}).`)
    const pendAgora = await store.execucoesPendentes(agora)
    checa(pendAgora.length === 0, 'tick 1: nada pendente agora — ambas execuções estão AGUARDANDO (espera de 3 dias).')
    // nenhuma ação de saída ainda
    const evAgora = await db.from('workflow_execucao_eventos').select('tipo').eq('organizacao_id', org!.id)
    const tiposAgora = (evAgora.data ?? []).map(e => e.tipo)
    checa(!tiposAgora.includes('email_enviado') && !tiposAgora.includes('tarefa_criada'), 'tick 1: nenhuma ação de saída disparada ainda (só esperando).')

    // --- "REINÍCIO" + TICK 2 (4 dias depois): retoma e ramifica ---
    const futuro = new Date(Date.now() + 4 * 86_400_000).toISOString()
    const r2 = await processarTudo(store, registro, ambiente, futuro)
    checa(r2.processadas === 2, `tick 2 (4 dias depois): retomou e processou as 2 execuções (processadas=${r2.processadas}).`)

    // Verifica os ramos por lead, lendo os eventos.
    async function eventosDoLead(leadId: string) {
      const ex = await db.from('workflow_execucoes').select('id, status').eq('organizacao_id', org!.id).eq('lead_id', leadId).single()
      const ev = await db.from('workflow_execucao_eventos').select('tipo, detalhe').eq('execucao_id', ex.data!.id).order('id', { ascending: true })
      return { status: ex.data!.status as string, tipos: (ev.data ?? []).map(e => e.tipo), eventos: ev.data ?? [] }
    }
    const A = await eventosDoLead(leadA)
    const B = await eventosDoLead(leadB)

    checa(A.status === 'concluido' && B.status === 'concluido', 'ambas execuções concluídas após o tick 2.')
    checa(A.tipos.includes('tarefa_criada') && !A.tipos.includes('email_enviado'), 'lead A (respondeu) → ramo A: TAREFA criada (sem e-mail).')
    checa(B.tipos.includes('email_enviado') && !B.tipos.includes('tarefa_criada'), 'lead B (não respondeu) → ramo B: E-MAIL (simulado, sem envio real).')
    const ramoA = A.eventos.find(e => e.tipo === 'ramo_escolhido') as { detalhe?: { ramo?: string } } | undefined
    const ramoB = B.eventos.find(e => e.tipo === 'ramo_escolhido') as { detalhe?: { ramo?: string } } | undefined
    checa(ramoA?.detalhe?.ramo === 'entao' && ramoB?.detalhe?.ramo === 'senao', 'decisão de branch registrada corretamente no log (entao/senao).')

    console.log(`\n${C.cyan}Linha do tempo — lead B:${C.r} ${B.tipos.join(' → ')}`)
    console.log(`${C.cyan}Linha do tempo — lead A:${C.r} ${A.tipos.join(' → ')}`)
  } finally {
    console.log(`\n${C.b}[teardown]${C.r}`)
    if (criado.org) {
      await db.from('workflow_execucao_eventos').delete().eq('organizacao_id', criado.org)
      await db.from('workflow_execucoes').delete().eq('organizacao_id', criado.org)
      await db.from('workflows').update({ versao_atual_id: null }).eq('organizacao_id', criado.org)
      await db.from('workflow_versoes').delete().eq('organizacao_id', criado.org)
      await db.from('workflows').delete().eq('organizacao_id', criado.org)
      await db.from('interacoes').delete().eq('organizacao_id', criado.org)
      await db.from('leads').delete().eq('organizacao_id', criado.org)
      await db.from('templates').delete().eq('organizacao_id', criado.org)
      await db.from('organizacoes').delete().eq('id', criado.org)
    }
    info('cenário limpo.')
  }

  console.log()
  if (falhas === 0) { console.log(`${C.grn}${C.b}DEMO OK${C.r} — gatilho→esperar→branch com espera persistida, ponta a ponta.\n`); process.exit(0) }
  else { console.log(`${C.red}${C.b}DEMO FALHOU${C.r} — ${falhas} asserção(ões).\n`); process.exit(1) }
}
main().catch((e) => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
