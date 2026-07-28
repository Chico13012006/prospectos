/**
 * Teste de ISOLAMENTO multi-tenant (RLS da migration 0006) — end-to-end e
 * EFÊMERO. Cria 2 organizações fake, 2 usuários de auth (um por org) e 1 lead
 * por org, depois LOGA como cada usuário (client anon + sessão → a RLS aplica
 * de verdade, `auth.uid()` resolve) e prova que:
 *
 *   - usuário da org A vê o lead da org A e SÓ ele;
 *   - NÃO vê o lead da org B nem os leads da org padrão (produção);
 *   - só enxerga a PRÓPRIA linha em `organizacoes`;
 *   - simetricamente para o usuário da org B.
 *
 * No fim (sempre, mesmo se falhar) LIMPA tudo o que criou: leads, perfis,
 * usuários de auth e organizações de teste.
 *
 *   npx tsx scripts/multitenant-isolamento.ts
 *
 * NÃO envia e-mail, NÃO chama o motor, NÃO toca em dados de produção (só cria e
 * apaga linhas próprias marcadas com o carimbo desta execução). Precisa de
 * service_role real (para montar/desmontar o cenário bypassando a RLS) e da
 * anon key (para os logins que exercitam a RLS).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) throw new Error('.env.local não encontrado em ' + p)
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
carregarEnvLocal()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const info = (s: string) => console.log(`${C.dim}·${C.r} ${s}`)

const ORG_PADRAO = '00000000-0000-0000-0000-000000000001'
const RUN = Date.now().toString(36) // carimbo único desta execução

let falhas = 0
function checa(cond: boolean, desc: string) {
  if (cond) ok(desc)
  else { no(desc); falhas++ }
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sk || sk.includes('sua_')) {
    no('SUPABASE_SERVICE_ROLE_KEY ausente/placeholder — o setup/teardown precisa de service_role.')
    process.exit(1)
  }
  if (!anon || anon.includes('sua_')) {
    no('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente/placeholder — os logins de teste precisam da anon key.')
    process.exit(1)
  }
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Teste de isolamento multi-tenant (RLS 0006) ==${C.r}`)
  console.log(`${C.dim}Supabase: ${url}  |  run=${RUN}${C.r}\n`)

  // Rastreamento p/ limpeza — preenchido conforme cria.
  const criado = { orgs: [] as string[], users: [] as string[], leads: [] as string[] }

  // Molde de lead: clona um lead REAL (garante todos os NOT NULL) e sobrescreve
  // os campos que precisam ser únicos/limpos para o teste.
  function moldeLead(base: Record<string, unknown>, tag: string, orgId: string) {
    const l: Record<string, unknown> = { ...base }
    delete l.id; delete l.created_at; delete l.updated_at
    delete (l as { usuarios?: unknown }).usuarios
    l.organizacao_id = orgId
    l.owner = 'n8n' // trava do motor: nunca 'engine' — este lead é inerte
    l.empresa = `ISO-TEST ${tag} ${RUN}`
    l.hubspot_id = `iso-test-${tag}-${RUN}`
    l.contato_email = `iso-${tag}-${RUN}@iso.test`
    l.responsavel_id = null
    l.responsavel_nome = null
    return l
  }

  try {
    // ---------------------------------------------------------------------
    // SETUP (service_role, bypassa RLS)
    // ---------------------------------------------------------------------
    console.log(`${C.b}[setup] criando 2 orgs, 2 usuários e 2 leads${C.r}`)

    // 1) organizações
    const orgsPayload = [
      { nome: `Org Iso A ${RUN}`, slug: `iso-a-${RUN}` },
      { nome: `Org Iso B ${RUN}`, slug: `iso-b-${RUN}` },
    ]
    const { data: orgs, error: orgErr } = await admin.from('organizacoes').insert(orgsPayload).select('id, slug')
    if (orgErr || !orgs || orgs.length !== 2) throw new Error('Falha criando organizações: ' + (orgErr?.message ?? '?'))
    const orgA = orgs.find(o => o.slug === `iso-a-${RUN}`)!.id as string
    const orgB = orgs.find(o => o.slug === `iso-b-${RUN}`)!.id as string
    criado.orgs.push(orgA, orgB)
    info(`org A = ${orgA}`)
    info(`org B = ${orgB}`)

    // 2) usuários de auth (email confirmado p/ permitir login por senha)
    const senha = `Iso!${RUN}Aa1`
    async function novoUser(tag: string): Promise<{ id: string; email: string }> {
      const email = `iso-${tag}-${RUN}@iso.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
      if (error || !data.user) throw new Error(`Falha criando user ${tag}: ${error?.message ?? '?'}`)
      criado.users.push(data.user.id)
      return { id: data.user.id, email }
    }
    const userA = await novoUser('a')
    const userB = await novoUser('b')
    info(`user A = ${userA.email}`)
    info(`user B = ${userB.email}`)

    // 3) perfis (org explícita — service_role não tem auth.uid p/ o trigger)
    const { error: perfErr } = await admin.from('perfis').insert([
      { id: userA.id, nome: 'Iso A', role: 'admin', organizacao_id: orgA },
      { id: userB.id, nome: 'Iso B', role: 'admin', organizacao_id: orgB },
    ])
    if (perfErr) throw new Error('Falha criando perfis: ' + perfErr.message)

    // 4) leads — clona um lead real p/ herdar os NOT NULL da tabela
    const { data: amostra, error: amErr } = await admin.from('leads').select('*').limit(1)
    if (amErr) throw new Error('Falha lendo lead-amostra: ' + amErr.message)
    if (!amostra || amostra.length === 0) throw new Error('Sem lead-amostra na tabela (esperava dados de produção).')
    const molde = amostra[0] as Record<string, unknown>
    const { data: leadsIns, error: leadErr } = await admin.from('leads').insert([
      moldeLead(molde, 'A', orgA),
      moldeLead(molde, 'B', orgB),
    ]).select('id, organizacao_id, empresa')
    if (leadErr || !leadsIns || leadsIns.length !== 2) throw new Error('Falha criando leads: ' + (leadErr?.message ?? '?'))
    const leadA = leadsIns.find(l => l.organizacao_id === orgA)!.id as string
    const leadB = leadsIns.find(l => l.organizacao_id === orgB)!.id as string
    criado.leads.push(leadA, leadB)
    ok('cenário montado (2 orgs, 2 usuários, 2 leads).')

    // ---------------------------------------------------------------------
    // ASSERÇÕES (client anon + login → a RLS decide o que cada um vê)
    // ---------------------------------------------------------------------
    async function comoUsuario(email: string): Promise<SupabaseClient> {
      const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await c.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error(`Login falhou (${email}): ${error.message}`)
      return c
    }

    console.log(`\n${C.b}[teste] org A não enxerga org B nem produção${C.r}`)
    const cliA = await comoUsuario(userA.email)
    {
      const { data: vistos, error } = await cliA.from('leads').select('id, organizacao_id, empresa')
      if (error) { no('org A: erro no SELECT leads — ' + error.message); falhas++ }
      else {
        const ids = new Set((vistos ?? []).map(l => l.id))
        const orgsVistas = new Set((vistos ?? []).map(l => l.organizacao_id))
        checa(ids.has(leadA), `org A VÊ o próprio lead (${vistos?.length ?? 0} lead(s) no total).`)
        checa(!ids.has(leadB), 'org A NÃO vê o lead da org B.')
        checa(!orgsVistas.has(ORG_PADRAO), 'org A NÃO vê nenhum lead da org padrão (produção).')
        checa(orgsVistas.size <= 1, 'org A só enxerga leads de UMA organização (a dela).')
      }
      // tentativa dirigida ao lead da org B: deve voltar vazio
      const alvo = await cliA.from('leads').select('id').eq('id', leadB)
      checa(!alvo.error && (alvo.data?.length ?? 0) === 0, 'org A busca o lead da org B por id → 0 linhas.')
      // organizacoes: só a própria
      const orgVis = await cliA.from('organizacoes').select('id')
      const idsOrg = new Set((orgVis.data ?? []).map(o => o.id))
      checa(!orgVis.error && idsOrg.size === 1 && idsOrg.has(orgA), 'org A só enxerga a PRÓPRIA linha em organizacoes.')
    }

    console.log(`\n${C.b}[teste] simétrico: org B não enxerga org A nem produção${C.r}`)
    const cliB = await comoUsuario(userB.email)
    {
      const { data: vistos, error } = await cliB.from('leads').select('id, organizacao_id')
      if (error) { no('org B: erro no SELECT leads — ' + error.message); falhas++ }
      else {
        const ids = new Set((vistos ?? []).map(l => l.id))
        const orgsVistas = new Set((vistos ?? []).map(l => l.organizacao_id))
        checa(ids.has(leadB), `org B VÊ o próprio lead (${vistos?.length ?? 0} lead(s) no total).`)
        checa(!ids.has(leadA), 'org B NÃO vê o lead da org A.')
        checa(!orgsVistas.has(ORG_PADRAO), 'org B NÃO vê nenhum lead da org padrão (produção).')
      }
      const orgVis = await cliB.from('organizacoes').select('id')
      const idsOrg = new Set((orgVis.data ?? []).map(o => o.id))
      checa(!orgVis.error && idsOrg.size === 1 && idsOrg.has(orgB), 'org B só enxerga a PRÓPRIA linha em organizacoes.')
    }

    // Sanidade: service_role (bypass) enxerga os dois leads — garante que o
    // "vazio" acima foi a RLS, não os dados sumirem.
    console.log(`\n${C.b}[sanidade] service_role enxerga ambos (prova que o vazio é RLS)${C.r}`)
    const ambos = await admin.from('leads').select('id').in('id', [leadA, leadB])
    checa(!ambos.error && (ambos.data?.length ?? 0) === 2, 'service_role vê os 2 leads de teste (bypass de RLS ok).')
  } finally {
    // ---------------------------------------------------------------------
    // TEARDOWN — apaga tudo o que este run criou (ordem: filhos → pais)
    // ---------------------------------------------------------------------
    console.log(`\n${C.b}[teardown] limpando cenário${C.r}`)
    if (criado.leads.length) {
      const r = await admin.from('leads').delete().in('id', criado.leads)
      r.error ? no('leads: ' + r.error.message) : info(`leads removidos (${criado.leads.length}).`)
    }
    if (criado.users.length) {
      // perfis somem por FK/limpeza; apaga explícito antes p/ não deixar órfão
      await admin.from('perfis').delete().in('id', criado.users)
      for (const uid of criado.users) {
        const r = await admin.auth.admin.deleteUser(uid)
        if (r.error) no('user ' + uid + ': ' + r.error.message)
      }
      info(`perfis + usuários removidos (${criado.users.length}).`)
    }
    if (criado.orgs.length) {
      const r = await admin.from('organizacoes').delete().in('id', criado.orgs)
      r.error ? no('orgs: ' + r.error.message) : info(`orgs removidas (${criado.orgs.length}).`)
    }
    // Rede de segurança: varre qualquer resíduo deste run pelo carimbo.
    await admin.from('leads').delete().like('hubspot_id', `iso-test-%-${RUN}`)
    await admin.from('organizacoes').delete().like('slug', `iso-%-${RUN}`)
  }

  console.log()
  if (falhas === 0) {
    console.log(`${C.grn}${C.b}ISOLAMENTO OK${C.r} — RLS separa as organizações. Nenhuma asserção falhou.\n`)
    process.exit(0)
  } else {
    console.log(`${C.red}${C.b}ISOLAMENTO FALHOU${C.r} — ${falhas} asserção(ões) quebraram (ver acima).\n`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(`${C.red}Erro no teste de isolamento:${C.r}`, e); process.exit(1) })
