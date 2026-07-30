/**
 * Demo end-to-end da RAMIFICAÇÃO NO PIPELINE (Fase 4.5, entrega 2) contra o banco
 * REAL, EFÊMERO e em modo SIMULAÇÃO (não envia e-mail nem grava interação real).
 *
 * Prova o fluxo de aceite com SALTO + ESPERA (o que o `ramificar` síncrono não
 * cobria): primeiro contato → esperar → saltar_se(respondeu → braço final) →
 * follow-up → esperar → saltar_se(respondeu → braço final) → tarefa → encerrar.
 *
 *   0 enviar_email(primeiro_contato)   1 esperar 3d
 *   2 saltar_se(respondeu → 8)         3 enviar_email(follow_up_1)   4 esperar 3d
 *   5 saltar_se(respondeu → 8)         6 criar_tarefa(ligação)       7 encerrar
 *   8 criar_tarefa(respondeu: status + notificar)
 *
 * 2 leads: A responde durante a 1ª espera (deve SALTAR p/ 8, sem follow-up);
 * B nunca responde (atravessa as 2 esperas persistidas e ENCERRA no braço 6/7,
 * sem vazar para o passo 8). Espera PERSISTIDA: entre os ticks não há estado em
 * memória — só o banco.
 *
 *   npx tsx scripts/workflows-salto-demo.ts
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
process.env.MODO_ENSAIO = 'true' // cinto de segurança extra

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const info = (s: string) => console.log(`${C.dim}·${C.r} ${s}`)
const RUN = Date.now().toString(36)
let falhas = 0
const checa = (c: boolean, d: string) => { c ? ok(d) : (no(d), falhas++) }

// destino do saltar_se referencia o ID estável do passo final (não o índice).
const ID_FINAL = 'passo-respondeu'
const DEF = {
  gatilho: { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 1 } },
  condicoes: [],
  acoes: [
    { tipo: 'enviar_email', config: { template: 'primeiro_contato' } },                                                // 0
    { tipo: 'esperar', config: { dias: 3 } },                                                                           // 1
    { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: ID_FINAL } }, // 2
    { tipo: 'enviar_email', config: { template: 'follow_up_1' } },                                                      // 3
    { tipo: 'esperar', config: { dias: 3 } },                                                                           // 4
    { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: ID_FINAL } }, // 5
    { tipo: 'criar_tarefa', config: { titulo: 'Ligar (sem resposta)' } },                                               // 6
    { tipo: 'encerrar', config: {} },                                                                                   // 7
    { id: ID_FINAL, tipo: 'criar_tarefa', config: { titulo: 'Respondeu: atualizar status + notificar' } },              // 8
  ],
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { criarWorkflowStore, criarWorkflow, publicar, registrarBlocosPadrao, AmbienteSupabase, processarTudo } =
    await import('../lib/workflows')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const db = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Demo ramificação no pipeline (saltar_se + esperar) — simulação, run=${RUN} ==${C.r}\n`)
  const criado = { org: '', leads: [] as string[], templates: 0, workflow: '' }

  try {
    const probe = await db.from('workflow_execucoes').select('id').limit(1)
    if (probe.error) { no(`workflow_execucoes inacessível — migration 0008 aplicada? (${probe.error.message})`); process.exit(1) }

    const { data: org } = await db.from('organizacoes').insert({ nome: `SaltoDemo ${RUN}`, slug: `salto-${RUN}` }).select('id').single()
    criado.org = org!.id

    // Templates genéricos (nicho=null) p/ as duas ações enviar_email do fluxo.
    for (const tipo of ['primeiro_contato', 'follow_up_1']) {
      const t = await db.from('templates').insert({
        organizacao_id: org!.id, nome: `Demo ${tipo} ${RUN}`, canal: 'email', tipo, ativo: true, nicho: null,
        assunto: 'Re: {empresa}', corpo: `[${tipo}] Olá {nome}, sobre a {empresa}.`,
      }).select('id')
      if (t.error) throw new Error(`template ${tipo}: ${t.error.message}`)
      criado.templates += 1
    }

    // Molde de lead real (herda NOT NULL) → 2 leads.
    const amostra = await db.from('leads').select('*').limit(1)
    if (amostra.error || !amostra.data?.length) throw new Error('sem lead-amostra')
    const molde = amostra.data[0] as Record<string, unknown>
    const agora = new Date().toISOString()
    async function novoLead(tag: string) {
      const l: Record<string, unknown> = { ...molde }
      delete l.id; delete l.created_at; delete l.updated_at; delete (l as { usuarios?: unknown }).usuarios
      l.organizacao_id = org!.id
      l.owner = 'n8n'; l.segmento = null
      l.empresa = `SALTO ${tag} ${RUN}`
      l.hubspot_id = `salto-${tag}-${RUN}`; l.contato_email = `salto-${tag}-${RUN}@iso.test`; l.contato_nome = `Contato ${tag}`
      l.responsavel_id = null; l.responsavel_nome = null
      l.proxima_acao = 'follow_up'; l.proxima_acao_data = agora // vencido → gatilho pega
      const r = await db.from('leads').insert(l).select('id').single()
      if (r.error) throw new Error(`lead ${tag}: ${r.error.message}`)
      criado.leads.push(r.data.id as string)
      return r.data.id as string
    }
    const leadA = await novoLead('A')
    const leadB = await novoLead('B')
    info(`org=${org!.id}  leadA(vai responder)=${leadA}  leadB(nunca responde)=${leadB}`)

    const store = criarWorkflowStore(org!.id, db)
    const wf = await criarWorkflow(store, { nome: `Salto ${RUN}`, definicao: DEF })
    criado.workflow = wf.id
    const { versao } = await publicar(store, wf.id, null)
    checa(versao.numero === 1, 'workflow publicado (versão nº 1).')

    const registro = registrarBlocosPadrao()
    const ambiente = new AmbienteSupabase(org!.id, { simular: true, client: db })

    async function eventosDoLead(leadId: string) {
      const ex = await db.from('workflow_execucoes').select('id, status').eq('organizacao_id', org!.id).eq('lead_id', leadId).single()
      const ev = await db.from('workflow_execucao_eventos').select('tipo, detalhe').eq('execucao_id', ex.data!.id).order('id', { ascending: true })
      const eventos = (ev.data ?? []) as { tipo: string; detalhe: Record<string, unknown> | null }[]
      return {
        status: ex.data!.status as string,
        tipos: eventos.map((e) => e.tipo),
        emails: eventos.filter((e) => e.tipo === 'email_enviado').map((e) => String(e.detalhe?.template)),
        tarefas: eventos.filter((e) => e.tipo === 'tarefa_criada').map((e) => String(e.detalhe?.titulo)),
        saltos: eventos.filter((e) => e.tipo === 'salto_avaliado'),
      }
    }

    // --- TICK 1 (agora): inscreve os 2, manda 1º contato, para na 1ª espera ---
    const r1 = await processarTudo(store, registro, ambiente, agora)
    checa(r1.inscritos === 2, `tick 1: inscreveu os 2 leads (inscritos=${r1.inscritos}).`)
    const A1 = await eventosDoLead(leadA)
    const B1 = await eventosDoLead(leadB)
    checa(A1.emails.length === 1 && A1.emails[0] === 'primeiro_contato', 'tick 1: lead A recebeu o 1º contato (simulado).')
    checa(!A1.emails.includes('follow_up_1') && !B1.emails.includes('follow_up_1'), 'tick 1: nenhum follow-up ainda (ambos na 1ª espera).')
    checa((await store.execucoesPendentes(agora)).length === 0, 'tick 1: ambas AGUARDANDO (espera de 3 dias) — nada pendente agora.')

    // lead A responde durante a 1ª espera (sinal do detectarResposta).
    const insResp = await db.from('interacoes').insert({
      organizacao_id: org!.id, lead_id: leadA, tipo: 'resposta', canal: 'email',
      descricao: 'Tenho interesse, pode ligar.', origem_acao: 'ia',
    })
    if (insResp.error) throw new Error('interacao resposta: ' + insResp.error.message)

    // --- "REINÍCIO" + TICK 2 (+4 dias): retoma; A salta p/ 8, B segue e para na 2ª espera ---
    const t2 = new Date(Date.now() + 4 * 86_400_000).toISOString()
    await processarTudo(store, registro, ambiente, t2)
    const A2 = await eventosDoLead(leadA)
    const B2 = await eventosDoLead(leadB)
    checa(A2.status === 'concluido', 'tick 2: lead A (respondeu) concluído.')
    checa(A2.saltos.some((s) => s.detalhe?.passou === true && s.detalhe?.destinoId === ID_FINAL), 'tick 2: lead A SALTOU no passo 2 (respondeu → destino por id).')
    checa(A2.tarefas.includes('Respondeu: atualizar status + notificar') && !A2.emails.includes('follow_up_1'),
      'tick 2: lead A foi pro braço final (sem follow-up).')
    checa(B2.status === 'aguardando' && B2.emails.includes('follow_up_1'),
      'tick 2: lead B (não respondeu) seguiu: follow-up enviado e parou na 2ª espera.')

    // --- "REINÍCIO" + TICK 3 (+8 dias): B atravessa a 2ª espera, cria tarefa e ENCERRA ---
    const t3 = new Date(Date.now() + 8 * 86_400_000).toISOString()
    await processarTudo(store, registro, ambiente, t3)
    const B3 = await eventosDoLead(leadB)
    checa(B3.status === 'concluido' && B3.tipos.includes('encerrado'), 'tick 3: lead B concluído via ENCERRAR (halt).')
    checa(B3.tarefas.includes('Ligar (sem resposta)') && !B3.tarefas.includes('Respondeu: atualizar status + notificar'),
      'tick 3: lead B ficou no braço "sem resposta" — NÃO vazou para o passo 8.')

    console.log(`\n${C.cyan}Linha do tempo — lead A (respondeu):${C.r} ${A2.tipos.join(' → ')}`)
    console.log(`${C.cyan}Linha do tempo — lead B (nunca respondeu):${C.r} ${B3.tipos.join(' → ')}`)
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
  if (falhas === 0) { console.log(`${C.grn}${C.b}DEMO OK${C.r} — salto condicional + espera persistida, ponta a ponta.\n`); process.exit(0) }
  else { console.log(`${C.red}${C.b}DEMO FALHOU${C.r} — ${falhas} asserção(ões).\n`); process.exit(1) }
}
main().catch((e) => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
