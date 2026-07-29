/**
 * Teste de ISOLAMENTO + versionamento das tabelas de Workflows (migration 0008),
 * end-to-end e EFÊMERO. Rodar DEPOIS de aplicar a 0008 no Supabase.
 *
 * Monta 2 orgs + 2 usuários (service_role), cria/publica 1 workflow por org e
 * inicia 1 execução em cada. Depois LOGA como cada usuário (client anon+sessão →
 * a RLS aplica) e prova que:
 *   - cada um vê só o PRÓPRIO workflow / versão / execução / evento;
 *   - NÃO vê os da outra org;
 *   - o trigger preenche organizacao_id em insert autenticado sem org;
 *   - WITH CHECK barra plantar workflow na org alheia.
 * Limpa tudo no fim (na ordem das FKs).
 *
 *   npx tsx scripts/workflows-isolamento.ts
 *
 * NÃO envia e-mail, NÃO roda motor. Precisa de service_role + anon key reais.
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

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const info = (s: string) => console.log(`${C.dim}·${C.r} ${s}`)
const RUN = Date.now().toString(36)
let falhas = 0
const checa = (cond: boolean, desc: string) => { cond ? ok(desc) : (no(desc), falhas++) }

const DEF = { gatilho: { tipo: 'campo_data_vence', config: { dias: 3 } }, condicoes: [], acoes: [{ tipo: 'enviar_email', config: {} }] }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { criarWorkflowStore, criarWorkflow, publicar, iniciarExecucao } = await import('../lib/workflows')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Isolamento + versionamento de Workflows (0008) — run=${RUN} ==${C.r}\n`)
  const criado = { orgs: [] as string[], users: [] as string[], workflows: [] as string[] }
  const senha = `Wf!${RUN}Aa1`

  try {
    // pré-checagem: a tabela existe? (0008 aplicada?)
    const probe = await admin.from('workflows').select('id').limit(1)
    if (probe.error) {
      no(`Tabela 'workflows' inacessível — a migration 0008 foi aplicada? (${probe.error.message})`)
      process.exit(1)
    }

    // setup: 2 orgs + 2 users + perfis
    const { data: orgs, error: oe } = await admin.from('organizacoes').insert([
      { nome: `Wf A ${RUN}`, slug: `wf-a-${RUN}` },
      { nome: `Wf B ${RUN}`, slug: `wf-b-${RUN}` },
    ]).select('id, slug')
    if (oe || !orgs) throw new Error('orgs: ' + (oe?.message ?? '?'))
    const orgA = orgs.find(o => o.slug === `wf-a-${RUN}`)!.id as string
    const orgB = orgs.find(o => o.slug === `wf-b-${RUN}`)!.id as string
    criado.orgs.push(orgA, orgB)

    async function novoUser(tag: string, org: string) {
      const email = `wf-${tag}-${RUN}@iso.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
      if (error || !data.user) throw new Error(`user ${tag}: ${error?.message ?? '?'}`)
      criado.users.push(data.user.id)
      await admin.from('perfis').insert({ id: data.user.id, nome: `Wf ${tag}`, role: 'admin', organizacao_id: org })
      return email
    }
    const emailA = await novoUser('a', orgA)
    const emailB = await novoUser('b', orgB)

    // cria + publica + executa 1 workflow por org (service_role, org explícita)
    async function montarWorkflow(org: string, nome: string) {
      const store = criarWorkflowStore(org, admin)
      const wf = await criarWorkflow(store, { nome, definicao: DEF })
      criado.workflows.push(wf.id)
      const { versao } = await publicar(store, wf.id, null)
      const exec = await iniciarExecucao(store, wf.id, { leadId: null })
      return { wf, versao, exec }
    }
    const A = await montarWorkflow(orgA, `Reativação A ${RUN}`)
    const B = await montarWorkflow(orgB, `Reativação B ${RUN}`)
    checa(A.versao.numero === 1 && B.versao.numero === 1, 'versionamento real: publicar gerou versão nº 1 em cada org.')
    info(`workflow A=${A.wf.id}  B=${B.wf.id}`)

    // logins → RLS aplica
    async function comoUsuario(email: string) {
      const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await c.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error(`login ${email}: ${error.message}`)
      return c
    }

    const cliA = await comoUsuario(emailA)
    {
      const wfs = await cliA.from('workflows').select('id, organizacao_id')
      const ids = new Set((wfs.data ?? []).map(w => w.id))
      checa(ids.has(A.wf.id) && !ids.has(B.wf.id), 'org A vê o próprio workflow e NÃO o da org B.')
      checa((wfs.data ?? []).every(w => w.organizacao_id === orgA), 'org A só vê workflows da própria org.')
      const vers = await cliA.from('workflow_versoes').select('id').eq('id', B.versao.id)
      checa(!vers.error && (vers.data?.length ?? 0) === 0, 'org A não vê a versão da org B.')
      const exs = await cliA.from('workflow_execucoes').select('id').eq('id', B.exec.id)
      checa(!exs.error && (exs.data?.length ?? 0) === 0, 'org A não vê a execução da org B.')
      const evs = await cliA.from('workflow_execucao_eventos').select('id').eq('execucao_id', B.exec.id)
      checa(!evs.error && (evs.data?.length ?? 0) === 0, 'org A não vê os eventos da org B.')

      // trigger: insert autenticado SEM org → preenchido com a org do usuário
      const ins = await cliA.from('workflows').insert({ nome: `via-trigger ${RUN}`, status: 'rascunho' }).select('id, organizacao_id').single()
      if (ins.error) { no('org A: insert sem org falhou — ' + ins.error.message); falhas++ }
      else {
        criado.workflows.push(ins.data.id as string)
        checa(ins.data.organizacao_id === orgA, 'trigger preencheu organizacao_id = org do usuário no insert autenticado.')
      }
      // negativo: plantar na org alheia é barrado
      const intruso = await cliA.from('workflows').insert({ nome: `intruso ${RUN}`, organizacao_id: orgB, status: 'rascunho' }).select('id')
      checa(!!intruso.error, `WITH CHECK barrou workflow na org alheia (${intruso.error?.code ?? 'rls'}).`)
      if (!intruso.error && intruso.data?.[0]) criado.workflows.push(intruso.data[0].id as string)
    }

    const cliB = await comoUsuario(emailB)
    {
      const wfs = await cliB.from('workflows').select('id')
      const ids = new Set((wfs.data ?? []).map(w => w.id))
      checa(ids.has(B.wf.id) && !ids.has(A.wf.id), 'org B vê o próprio workflow e NÃO o da org A.')
    }
  } finally {
    console.log(`\n${C.b}[teardown]${C.r}`)
    // ordem das FKs: eventos → execucoes → (zera versao_atual_id) → versoes → workflows
    if (criado.orgs.length) {
      await admin.from('workflow_execucao_eventos').delete().in('organizacao_id', criado.orgs)
      await admin.from('workflow_execucoes').delete().in('organizacao_id', criado.orgs)
      await admin.from('workflows').update({ versao_atual_id: null }).in('organizacao_id', criado.orgs)
      await admin.from('workflow_versoes').delete().in('organizacao_id', criado.orgs)
      await admin.from('workflows').delete().in('organizacao_id', criado.orgs)
    }
    if (criado.users.length) {
      await admin.from('perfis').delete().in('id', criado.users)
      for (const u of criado.users) await admin.auth.admin.deleteUser(u)
    }
    if (criado.orgs.length) await admin.from('organizacoes').delete().in('id', criado.orgs)
    info('cenário limpo.')
  }

  console.log()
  if (falhas === 0) { console.log(`${C.grn}${C.b}WORKFLOWS ISOLAM OK${C.r} — RLS + versionamento validados no banco real.\n`); process.exit(0) }
  else { console.log(`${C.red}${C.b}FALHOU${C.r} — ${falhas} asserção(ões).\n`); process.exit(1) }
}
main().catch((e) => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
