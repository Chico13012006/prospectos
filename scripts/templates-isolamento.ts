/**
 * Teste de ISOLAMENTO da tabela `templates` (RLS 0006/0007) — end-to-end e
 * EFÊMERO, no mesmo padrão de scripts/multitenant-isolamento.ts.
 *
 * Cria 2 organizações fake, 2 usuários de auth e 1 template por org; depois
 * LOGA como cada usuário (client anon + sessão → a RLS aplica de verdade) e
 * prova que:
 *   - a org A vê o próprio template e SÓ ele (não vê o da B nem os de produção);
 *   - buscar o template da B por id devolve 0 linhas;
 *   - UPDATE/DELETE dirigidos ao template da B não afetam nenhuma linha;
 *   - INSERT forçando organizacao_id da B é barrado pelo WITH CHECK;
 *   - INSERT sem organizacao_id recebe a organização da sessão (trigger);
 *   - simétrico para a org B.
 *
 * No fim (sempre, mesmo em falha) limpa TUDO o que criou e confere que os
 * templates de produção continuam intactos.
 *
 *   npx tsx scripts/templates-isolamento.ts --confirmar
 *
 * NÃO envia e-mail/WhatsApp, NÃO roda motor e NÃO toca em nenhuma linha
 * existente: só cria e apaga linhas próprias, carimbadas com o run desta
 * execução. Precisa de service_role (setup/teardown) e anon key (logins).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { exigirConfirmacao } from './_guarda'

for (const linha of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i <= 0 || linha.trim().startsWith('#')) continue
  const k = linha.slice(0, i).trim()
  if (!(k in process.env)) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const C = { dim: '\x1b[2m', b: '\x1b[1m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const info = (s: string) => console.log(`${C.dim}·${C.r} ${s}`)
const RUN = Date.now().toString(36)

let falhas = 0
const checa = (cond: boolean, desc: string) => { cond ? ok(desc) : (no(desc), falhas++) }

exigirConfirmacao({
  nome: 'Isolamento de templates (RLS) — efêmero',
  alvo: 'Supabase de produção: cria e apaga 2 organizações, 2 usuários e 2 templates de teste',
  efeitos: [
    'cria 2 organizações fake, 2 usuários de auth e 1 template em cada',
    'loga como cada usuário e tenta ler/alterar o template da outra organização',
    'apaga tudo o que criou no fim, mesmo em caso de falha',
    'não altera nenhuma linha existente e não envia nada',
  ],
})

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sk || sk.includes('sua_')) { no('SUPABASE_SERVICE_ROLE_KEY ausente/placeholder.'); process.exit(1) }
  if (!anon || anon.includes('sua_')) { no('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente/placeholder.'); process.exit(1) }
  const admin = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Isolamento de templates — run=${RUN} ==${C.r}\n`)
  const criado = { orgs: [] as string[], users: [] as string[], templates: [] as string[] }

  // Retrato de produção ANTES: nada disto pode mudar.
  const { count: antesTotal } = await admin.from('templates').select('id', { count: 'exact', head: true })
  info(`templates em produção antes: ${antesTotal}`)

  try {
    const { data: orgs, error: orgErr } = await admin.from('organizacoes').insert([
      { nome: `Org Tpl A ${RUN}`, slug: `tpl-a-${RUN}` },
      { nome: `Org Tpl B ${RUN}`, slug: `tpl-b-${RUN}` },
    ]).select('id, slug')
    if (orgErr || orgs?.length !== 2) throw new Error('Falha criando organizações: ' + (orgErr?.message ?? '?'))
    const orgA = orgs.find((o) => o.slug === `tpl-a-${RUN}`)!.id as string
    const orgB = orgs.find((o) => o.slug === `tpl-b-${RUN}`)!.id as string
    criado.orgs.push(orgA, orgB)

    const senha = `Tpl!${RUN}Aa1`
    async function novoUser(tag: string) {
      const email = `tpl-${tag}-${RUN}@iso.test`
      const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
      if (error || !data.user) throw new Error(`Falha criando user ${tag}: ${error?.message ?? '?'}`)
      criado.users.push(data.user.id)
      return { id: data.user.id, email }
    }
    const userA = await novoUser('a')
    const userB = await novoUser('b')

    const { error: perfErr } = await admin.from('perfis').insert([
      { id: userA.id, nome: 'Tpl A', role: 'admin', organizacao_id: orgA },
      { id: userB.id, nome: 'Tpl B', role: 'admin', organizacao_id: orgB },
    ])
    if (perfErr) throw new Error('Falha criando perfis: ' + perfErr.message)

    const { data: tpls, error: tplErr } = await admin.from('templates').insert([
      { organizacao_id: orgA, nome: `ISO A ${RUN}`, tipo: `iso_a_${RUN}`, canal: 'email', assunto: 'A', corpo: 'Conteúdo da A', ativo: true },
      { organizacao_id: orgB, nome: `ISO B ${RUN}`, tipo: `iso_b_${RUN}`, canal: 'email', assunto: 'B', corpo: 'Segredo da B', ativo: true },
    ]).select('id, organizacao_id')
    if (tplErr || tpls?.length !== 2) throw new Error('Falha criando templates: ' + (tplErr?.message ?? '?'))
    const tplA = tpls.find((t) => t.organizacao_id === orgA)!.id as string
    const tplB = tpls.find((t) => t.organizacao_id === orgB)!.id as string
    criado.templates.push(tplA, tplB)
    ok('cenário montado (2 orgs, 2 usuários, 2 templates).')

    async function comoUsuario(email: string): Promise<SupabaseClient> {
      const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await c.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error(`Login falhou (${email}): ${error.message}`)
      return c
    }

    console.log(`\n${C.b}[teste] sessão A${C.r}`)
    const cliA = await comoUsuario(userA.email)
    {
      const { data: vistos, error } = await cliA.from('templates').select('id, organizacao_id, corpo')
      checa(!error, `SELECT sem erro para a sessão A (${error?.message ?? 'ok'})`)
      const ids = new Set((vistos ?? []).map((t) => t.id))
      const orgsVistas = new Set((vistos ?? []).map((t) => t.organizacao_id))
      checa(ids.has(tplA), `A vê o próprio template (total visível: ${vistos?.length ?? 0})`)
      checa(!ids.has(tplB), 'A NÃO vê o template da B')
      checa(orgsVistas.size === 1 && orgsVistas.has(orgA), 'A só enxerga templates da PRÓPRIA organização (nenhum de produção)')
      checa(!JSON.stringify(vistos ?? []).includes('Segredo da B'), 'nenhum conteúdo da B aparece para A')

      const alvo = await cliA.from('templates').select('id').eq('id', tplB)
      checa(!alvo.error && (alvo.data?.length ?? 0) === 0, 'A busca o template da B por id → 0 linhas')

      const upd = await cliA.from('templates').update({ nome: `INVADIDO ${RUN}` }).eq('id', tplB).select('id')
      checa(!upd.error && (upd.data?.length ?? 0) === 0, 'UPDATE de A no template da B → 0 linhas afetadas')

      const del = await cliA.from('templates').delete().eq('id', tplB).select('id')
      checa(!del.error && (del.data?.length ?? 0) === 0, 'DELETE de A no template da B → 0 linhas afetadas')

      const insCross = await cliA.from('templates').insert({
        organizacao_id: orgB, nome: `PLANTADO ${RUN}`, tipo: `plantado_${RUN}`, canal: 'email', assunto: 'x', corpo: 'x',
      }).select('id')
      checa(!!insCross.error, `INSERT de A forçando organizacao_id=B barrado (${insCross.error?.code ?? 'sem erro!'})`)
      if (insCross.data?.[0]?.id) criado.templates.push(insCross.data[0].id as string)

      const insProprio = await cliA.from('templates').insert({
        nome: `AUTO ${RUN}`, tipo: `auto_${RUN}`, canal: 'email', assunto: 'x', corpo: 'x',
      }).select('id, organizacao_id')
      checa(!insProprio.error && insProprio.data?.[0]?.organizacao_id === orgA, 'INSERT de A sem organizacao_id recebe a org da sessão (trigger)')
      if (insProprio.data?.[0]?.id) criado.templates.push(insProprio.data[0].id as string)
    }

    console.log(`\n${C.b}[teste] sessão B (simétrico)${C.r}`)
    const cliB = await comoUsuario(userB.email)
    {
      const { data: vistos } = await cliB.from('templates').select('id, organizacao_id')
      const ids = new Set((vistos ?? []).map((t) => t.id))
      const orgsVistas = new Set((vistos ?? []).map((t) => t.organizacao_id))
      checa(ids.has(tplB), `B vê o próprio template (total visível: ${vistos?.length ?? 0})`)
      checa(!ids.has(tplA), 'B NÃO vê o template da A')
      checa(orgsVistas.size === 1 && orgsVistas.has(orgB), 'B só enxerga templates da PRÓPRIA organização')
    }

    console.log(`\n${C.b}[sanidade] service_role (bypass de RLS)${C.r}`)
    const ambos = await admin.from('templates').select('id, nome').in('id', [tplA, tplB])
    checa((ambos.data?.length ?? 0) === 2, 'service_role vê os 2 templates de teste (o vazio acima foi a RLS)')
    const bIntacto = await admin.from('templates').select('nome, corpo').eq('id', tplB).maybeSingle()
    checa(bIntacto.data?.nome === `ISO B ${RUN}` && bIntacto.data?.corpo === 'Segredo da B', 'template da B intacto depois das tentativas da A')
  } finally {
    console.log(`\n${C.b}[limpeza]${C.r}`)
    if (criado.templates.length) {
      const { error } = await admin.from('templates').delete().in('id', criado.templates)
      checa(!error, `templates de teste apagados (${criado.templates.length})`)
    }
    if (criado.orgs.length) {
      // Qualquer sobra criada dentro das orgs efêmeras sai junto.
      await admin.from('templates').delete().in('organizacao_id', criado.orgs)
      await admin.from('perfil_permissoes').delete().in('organizacao_id', criado.orgs)
      await admin.from('perfis').delete().in('organizacao_id', criado.orgs)
    }
    for (const id of criado.users) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) { no(`usuário ${id} não removido: ${error.message}`); falhas++ }
    }
    if (criado.users.length) ok(`usuários de teste removidos (${criado.users.length})`)
    if (criado.orgs.length) {
      const { error } = await admin.from('organizacoes').delete().in('id', criado.orgs)
      checa(!error, `organizações de teste removidas (${criado.orgs.length})`)
    }

    const { count: depoisTotal } = await admin.from('templates').select('id', { count: 'exact', head: true })
    checa(depoisTotal === antesTotal, `templates em produção inalterados (${antesTotal} → ${depoisTotal})`)
    const sobras = await admin.from('organizacoes').select('id').like('slug', `tpl-%-${RUN}`)
    checa((sobras.data?.length ?? 0) === 0, 'nenhuma organização temporária sobrando')
  }

  console.log(falhas ? `\n${C.red}${falhas} FALHA(S)${C.r}` : `\n${C.grn}ISOLAMENTO OK${C.r}`)
  process.exit(falhas ? 1 : 0)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
