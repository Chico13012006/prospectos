/**
 * Preflight/verificação da migration 0006 (multi-tenant + RLS). READ-ONLY:
 * não escreve, não altera schema, não apaga nada. Serve para rodar ANTES da
 * migration (ver o que existe e medir o risco de RLS) e DEPOIS (confirmar que
 * organizacao_id/organizacoes/config-por-org ficaram no lugar).
 *
 *   npx tsx scripts/multitenant-preflight.ts
 *
 * Usa service_role (bypassa RLS) só para inspecionar. O risco nº1 medido aqui:
 * com a RLS ligada, TODO usuário de auth precisa de uma linha em `perfis` com
 * organizacao_id — senão current_org_id() volta NULL e as leituras dele zeram.
 */
import fs from 'node:fs'
import path from 'node:path'

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

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const ok = (s: string) => console.log(`${C.grn}✓${C.r} ${s}`)
const no = (s: string) => console.log(`${C.red}✗${C.r} ${s}`)
const warn = (s: string) => console.log(`${C.yel}!${C.r} ${s}`)

const ORG_PADRAO = '00000000-0000-0000-0000-000000000001'
const TABELAS = ['leads', 'interacoes', 'templates', 'usuarios', 'perfis'] as const

// PostgREST sinaliza tabela ausente com PGRST205 ("Could not find the table")
// e coluna ausente com o SQLSTATE 42703. Sondamos direto (select da coluna) em
// vez de inferir por filtro — inferir por .not()/.is() dá falso-positivo.
const semTabela = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message ?? ''))
const semColuna = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42703' || /column .* does not exist/i.test(e.message ?? ''))

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sk || sk.includes('sua_')) {
    no('SUPABASE_SERVICE_ROLE_KEY ausente/placeholder — este preflight precisa de service_role.')
    process.exit(1)
  }
  const db = createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log(`\n${C.b}== Preflight multi-tenant (migration 0006) — READ-ONLY ==${C.r}`)
  console.log(`${C.dim}Supabase: ${url}${C.r}\n`)

  // 1) Tabela organizacoes existe?
  console.log(`${C.b}[1] Tabela organizacoes${C.r}`)
  const orgSel = await db.from('organizacoes').select('id, nome, slug, ativo')
  const orgExiste = !semTabela(orgSel.error)
  if (!orgExiste) {
    warn('Ainda NÃO existe (migration 0006 não aplicada). Esperado ANTES da migration.')
  } else {
    ok(`Existe. ${orgSel.data?.length ?? 0} organização(ões):`)
    for (const o of orgSel.data ?? []) console.log(`     ${o.id}  ${o.nome} (${o.slug})  ativo=${o.ativo}`)
    const temPadrao = (orgSel.data ?? []).some((o) => o.id === ORG_PADRAO)
    temPadrao ? ok('Org padrão (UUID fixo do backfill) presente.') : no('Org padrão NÃO encontrada — backfill não rodou.')
  }

  // 2) organizacao_id nas tabelas de dados + contagem + linhas órfãs (sem org).
  console.log(`\n${C.b}[2] Coluna organizacao_id + backfill nas tabelas de dados${C.r}`)
  for (const t of TABELAS) {
    const total = await db.from(t).select('id', { count: 'exact', head: true })
    if (total.error) { no(`${t}: erro ao contar (${total.error.message})`); continue }
    // Sonda a coluna direto: se ausente, 42703.
    const probe = await db.from(t).select('organizacao_id').limit(1)
    if (semColuna(probe.error)) {
      warn(`${t}: ${total.count} linhas | coluna organizacao_id ainda NÃO existe (esperado antes da migration).`)
      continue
    }
    const nulos = await db.from(t).select('id', { count: 'exact', head: true }).is('organizacao_id', null)
    if (nulos.error) { no(`${t}: erro ao medir nulos (${nulos.error.message})`); continue }
    const nNulos = nulos.count ?? 0
    if (nNulos === 0) ok(`${t}: ${total.count} linhas, todas com organizacao_id.`)
    else no(`${t}: ${total.count} linhas, ${nNulos} SEM organizacao_id (backfill incompleto → RLS as esconde).`)
  }

  // 3) configuracoes_motor: singleton (id) x por-org (organizacao_id).
  console.log(`\n${C.b}[3] configuracoes_motor${C.r}`)
  const cfg = await db.from('configuracoes_motor').select('*')
  if (cfg.error) {
    warn(`Não consegui ler (${cfg.error.message}).`)
  } else {
    const linhas = cfg.data ?? []
    const temOrg = linhas.length === 0 || 'organizacao_id' in (linhas[0] as object)
    console.log(`     ${linhas.length} linha(s). ${temOrg ? 'tem coluna organizacao_id (por-org).' : `${C.yel}ainda singleton (sem organizacao_id).${C.r}`}`)
  }

  // 4) RISCO Nº1: usuários de auth sem perfil / sem organizacao_id.
  console.log(`\n${C.b}[4] RISCO RLS — usuários de auth x perfis (organizacao_id)${C.r}`)
  const authList = await db.auth.admin.listUsers()
  if (authList.error) {
    warn(`Não consegui listar usuários de auth (${authList.error.message}).`)
  } else {
    const users = authList.data.users
    const perfis = await db.from('perfis').select('id, organizacao_id, role')
    if (semColuna(perfis.error)) {
      const perfisSemCol = await db.from('perfis').select('id, role')
      const idsComPerfil = new Set((perfisSemCol.data ?? []).map((p) => p.id))
      warn(`perfis ainda sem organizacao_id (pré-migration). ${users.length} usuário(s) de auth, ${perfisSemCol.data?.length ?? 0} perfil(is).`)
      const semPerfil = users.filter((u) => !idsComPerfil.has(u.id))
      if (semPerfil.length) {
        no(`${semPerfil.length} usuário(s) de auth SEM linha em perfis (após RLS ligada, veriam TUDO vazio):`)
        for (const u of semPerfil) console.log(`     ${u.email ?? u.id}`)
      } else ok('Todo usuário de auth tem linha em perfis.')
    } else {
      const byId = new Map((perfis.data ?? []).map((p) => [p.id, p]))
      const problemas = users.filter((u) => { const p = byId.get(u.id); return !p || !p.organizacao_id })
      console.log(`     ${users.length} usuário(s) de auth, ${perfis.data?.length ?? 0} perfil(is).`)
      if (problemas.length === 0) ok('Todos os usuários de auth têm perfil com organizacao_id — RLS não vai cegá-los.')
      else {
        no(`${problemas.length} usuário(s) ficariam CEGOS pela RLS (sem perfil ou sem organizacao_id):`)
        for (const u of problemas) {
          const p = byId.get(u.id)
          console.log(`     ${u.email ?? u.id} — ${!p ? 'sem perfil' : 'perfil sem organizacao_id'}`)
        }
      }
    }
  }

  console.log(`\n${C.dim}Preflight concluído (nada foi alterado).${C.r}\n`)
}

main().catch((e) => { console.error('Erro no preflight:', e); process.exit(1) })
