/**
 * Diagnóstico de RLS por tabela — EFÊMERO e READ-ONLY em relação a produção.
 * Cria UMA org de teste + UM usuário, e para cada tabela multi-tenant compara:
 *   - quantas linhas o service_role vê (bypass de RLS = total real);
 *   - quantas linhas o usuário de teste vê (deveria ver ~0 de produção; só o que
 *     for da própria org de teste).
 * Se o usuário de teste vê muitas linhas (as de produção), a RLS daquela tabela
 * NÃO está isolando. Limpa tudo no fim.
 *
 *   npx tsx scripts/multitenant-diag-rls.ts
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

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', yel: '\x1b[33m', r: '\x1b[0m' }
const RUN = Date.now().toString(36)
const TABELAS = ['leads', 'interacoes', 'templates', 'usuarios', 'perfis', 'configuracoes_motor', 'organizacoes'] as const

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Diagnóstico RLS por tabela (run=${RUN}) ==${C.r}\n`)
  const criado = { org: '', user: '' }
  try {
    const { data: org } = await admin.from('organizacoes').insert({ nome: `Diag ${RUN}`, slug: `diag-${RUN}` }).select('id').single()
    criado.org = org!.id
    const email = `diag-${RUN}@iso.test`, senha = `Diag!${RUN}Aa1`
    const { data: u } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
    criado.user = u!.user!.id
    await admin.from('perfis').insert({ id: u!.user!.id, nome: 'Diag', role: 'admin', organizacao_id: org!.id })

    const cli = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await cli.auth.signInWithPassword({ email, password: senha })
    if (login.error) throw new Error('login: ' + login.error.message)

    console.log(`${C.b}tabela                  service_role   usuário-teste   veredito${C.r}`)
    for (const t of TABELAS) {
      const tot = await admin.from(t).select('*', { count: 'exact', head: true })
      const vis = await cli.from(t).select('*', { count: 'exact', head: true })
      const total = tot.count ?? -1
      const visto = vis.error ? `ERRO(${vis.error.code ?? ''})` : String(vis.count ?? -1)
      // esperado p/ o usuário de teste: só linhas da PRÓPRIA org de teste.
      // perfis: 1 (o próprio). organizacoes: 1 (a dele). demais: 0.
      const esperadoZero = t !== 'perfis' && t !== 'organizacoes'
      let veredito: string
      if (vis.error) veredito = `${C.yel}erro ao ler${C.r}`
      else if (esperadoZero) veredito = (vis.count ?? -1) === 0 ? `${C.grn}ISOLA ok${C.r}` : `${C.red}VAZA (vê produção)${C.r}`
      else veredito = (vis.count ?? -1) <= 1 ? `${C.grn}ISOLA ok${C.r}` : `${C.red}VAZA${C.r}`
      console.log(`${t.padEnd(22)}  ${String(total).padStart(10)}   ${visto.padStart(12)}   ${veredito}`)
    }
  } finally {
    if (criado.user) { await admin.from('perfis').delete().eq('id', criado.user); await admin.auth.admin.deleteUser(criado.user) }
    if (criado.org) await admin.from('organizacoes').delete().eq('id', criado.org)
    console.log(`\n${C.dim}cenário de diagnóstico limpo.${C.r}\n`)
  }
}
main().catch((e) => { console.error('erro:', e); process.exit(1) })
