/**
 * Teste (b) — painel de lead grava sob RLS via trigger set_org_id_default.
 * EFÊMERO. Simula o CAMINHO DO BROWSER (lib/api.ts: createLead / registrarNota),
 * que insere via client anon+sessão SEM informar organizacao_id. Prova que:
 *
 *   - inserir lead sem organizacao_id FUNCIONA e o trigger preenche com a org
 *     do usuário logado (current_org_id());
 *   - registrar nota (interacoes) sem organizacao_id idem;
 *   - o usuário NÃO consegue plantar uma linha em OUTRA org (WITH CHECK barra
 *     um insert com organizacao_id explícito != a dele).
 *
 * Loga como um usuário de teste real (a RLS + o trigger só valem com auth.uid).
 * Limpa tudo no fim. NÃO envia e-mail, NÃO chama o motor.
 *
 *   npx tsx scripts/multitenant-trigger-nota.ts
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
const ORG_PADRAO = '00000000-0000-0000-0000-000000000001'
const RUN = Date.now().toString(36)

let falhas = 0
const checa = (cond: boolean, desc: string) => { cond ? ok(desc) : (no(desc), falhas++) }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Teste (b): painel grava sob RLS (trigger set_org_id_default) ==${C.r}`)
  console.log(`${C.dim}Supabase: ${url}  |  run=${RUN}${C.r}\n`)

  const criado = { org: '', user: '', leads: [] as string[], interacoes: [] as string[] }
  try {
    // setup: 1 org + 1 user + perfil (org explícita — service_role)
    const { data: org, error: oe } = await admin.from('organizacoes')
      .insert({ nome: `Trig ${RUN}`, slug: `trig-${RUN}` }).select('id').single()
    if (oe || !org) throw new Error('org: ' + (oe?.message ?? '?'))
    criado.org = org.id
    const email = `trig-${RUN}@iso.test`, senha = `Trig!${RUN}Aa1`
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
    if (ue || !u?.user) throw new Error('user: ' + (ue?.message ?? '?'))
    criado.user = u.user.id
    await admin.from('perfis').insert({ id: u.user.id, nome: 'Trig', role: 'admin', organizacao_id: org.id })
    info(`org=${org.id}  user=${email}`)

    // molde de lead real (herda os NOT NULL da tabela)
    const { data: amostra, error: ae } = await admin.from('leads').select('*').limit(1)
    if (ae || !amostra?.length) throw new Error('molde lead: ' + (ae?.message ?? 'sem amostra'))
    const molde = amostra[0] as Record<string, unknown>

    // login → daqui pra frente a RLS e o trigger valem (auth.uid presente)
    const cli = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await cli.auth.signInWithPassword({ email, password: senha })
    if (login.error) throw new Error('login: ' + login.error.message)

    // --- 1) createLead SEM organizacao_id (caminho lib/api.ts createLead) ---
    console.log(`\n${C.b}[1] inserir lead sem organizacao_id → trigger preenche${C.r}`)
    const novoLead: Record<string, unknown> = { ...molde }
    delete novoLead.id; delete novoLead.created_at; delete novoLead.updated_at
    delete (novoLead as { usuarios?: unknown }).usuarios
    delete novoLead.organizacao_id // <<< o ponto do teste: NÃO informa a org
    novoLead.owner = 'n8n'
    novoLead.empresa = `TRIG-TEST ${RUN}`
    novoLead.hubspot_id = `trig-test-${RUN}`
    novoLead.contato_email = `trig-${RUN}@iso.test`
    novoLead.responsavel_id = null
    novoLead.responsavel_nome = null
    const insLead = await cli.from('leads').insert(novoLead).select('id, organizacao_id').single()
    if (insLead.error) { no('insert do lead falhou: ' + insLead.error.message); falhas++ }
    else {
      criado.leads.push(insLead.data.id as string)
      checa(!!insLead.data.organizacao_id, 'lead inserido tem organizacao_id preenchido (não nulo).')
      checa(insLead.data.organizacao_id === org.id, 'organizacao_id = org do usuário logado (trigger correto).')
      checa(insLead.data.organizacao_id !== ORG_PADRAO, 'NÃO caiu na org padrão de produção.')
    }
    const leadId = insLead.data?.id as string | undefined

    // --- 2) registrarNota SEM organizacao_id (caminho lib/api.ts registrarNota) ---
    console.log(`\n${C.b}[2] registrar nota (interacoes) sem organizacao_id → trigger preenche${C.r}`)
    if (!leadId) { no('sem lead do passo 1 — pulei a nota.'); falhas++ }
    else {
      const insNota = await cli.from('interacoes').insert({
        lead_id: leadId, tipo: 'nota', canal: 'plataforma',
        descricao: `nota de teste ${RUN}`, origem_acao: 'humano',
      }).select('id, organizacao_id').single()
      if (insNota.error) { no('insert da nota falhou: ' + insNota.error.message); falhas++ }
      else {
        criado.interacoes.push(insNota.data.id as string)
        checa(insNota.data.organizacao_id === org.id, 'nota gravada com organizacao_id = org do usuário (trigger correto).')
      }
      // e o usuário relê a própria nota (RLS select ok)
      const releitura = await cli.from('interacoes').select('id').eq('lead_id', leadId)
      checa(!releitura.error && (releitura.data?.length ?? 0) === 1, 'usuário relê a própria nota (RLS select ok).')
    }

    // --- 3) NEGATIVO: não pode plantar linha em OUTRA org (WITH CHECK) ---
    console.log(`\n${C.b}[3] negativo: inserir lead com org EXPLÍCITA de outra org → barrado${C.r}`)
    const intruso: Record<string, unknown> = { ...novoLead }
    intruso.organizacao_id = ORG_PADRAO // tenta plantar na produção
    intruso.hubspot_id = `trig-intruso-${RUN}`
    intruso.contato_email = `trig-intruso-${RUN}@iso.test`
    const insIntruso = await cli.from('leads').insert(intruso).select('id')
    if (!insIntruso.error && insIntruso.data?.length) {
      no('VAZOU: usuário conseguiu inserir lead na org padrão (WITH CHECK falhou).')
      falhas++
      criado.leads.push(insIntruso.data[0].id as string) // p/ limpar
    } else {
      checa(!!insIntruso.error, `WITH CHECK barrou o insert em outra org (erro: ${insIntruso.error?.code ?? 'rls'}).`)
    }
  } finally {
    console.log(`\n${C.b}[teardown] limpando${C.r}`)
    if (criado.interacoes.length) await admin.from('interacoes').delete().in('id', criado.interacoes)
    if (criado.leads.length) await admin.from('leads').delete().in('id', criado.leads)
    // rede de segurança pelo carimbo
    await admin.from('interacoes').delete().like('descricao', `nota de teste ${RUN}`)
    await admin.from('leads').delete().like('hubspot_id', `trig-%-${RUN}`)
    if (criado.user) { await admin.from('perfis').delete().eq('id', criado.user); await admin.auth.admin.deleteUser(criado.user) }
    if (criado.org) await admin.from('organizacoes').delete().eq('id', criado.org)
    info('cenário limpo.')
  }

  console.log()
  if (falhas === 0) { console.log(`${C.grn}${C.b}PAINEL GRAVA OK${C.r} — trigger preenche org e WITH CHECK protege.\n`); process.exit(0) }
  else { console.log(`${C.red}${C.b}FALHOU${C.r} — ${falhas} asserção(ões) quebraram.\n`); process.exit(1) }
}
main().catch((e) => { console.error(`${C.red}erro:${C.r}`, e); process.exit(1) })
