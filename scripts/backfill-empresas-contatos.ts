/**
 * Backfill Empresa × Contato (Fase 2b) — política CONSERVADORA (lib/empresas/dedup).
 * Isolado por organização, aditivo e idempotente. NÃO altera estado/pipeline/
 * responsável/próxima-ação/histórico do lead — só preenche leads.empresa_id/
 * contato_id e cria empresas/contatos com origem='lead_backfill'.
 *
 *   npx tsx scripts/backfill-empresas-contatos.ts           # executa + relatório + validação
 *   npx tsx scripts/backfill-empresas-contatos.ts rollback  # desfaz (idempotente)
 *   npx tsx scripts/backfill-empresas-contatos.ts selftest   # backfill→valida→idempotência→rollback→restaura
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { planejarDedup, normalizarNomeEmpresa, type LeadEntrada } from '../lib/empresas/dedup'
import { normalizarCnpj } from '../lib/empresas/cnpj'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0 || linha.startsWith('#')) continue
    const k = linha.slice(0, i).trim()
    if (!(k in process.env)) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}
carregarEnvLocal()

const C = { grn: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m' }
type Client = pg.Client

interface Snapshot { leads: number; interacoes: number; checksum: string }

// Assinatura das colunas que NÃO podem mudar (tudo menos empresa_id/contato_id).
async function snapshot(c: Client, org: string): Promise<Snapshot> {
  const leads = (await c.query('select count(*)::int n from leads where organizacao_id=$1', [org])).rows[0].n
  const interacoes = (await c.query('select count(*)::int n from interacoes where organizacao_id=$1', [org])).rows[0].n
  const checksum = (await c.query(
    `select coalesce(md5(string_agg(
        id::text||'|'||coalesce(estagio,'')||'|'||coalesce(owner,'')||'|'||perdido::text||'|'||
        coalesce(responsavel_id::text,'')||'|'||coalesce(responsavel_nome,'')||'|'||
        coalesce(proxima_acao,'')||'|'||coalesce(proxima_acao_data::text,'')||'|'||
        coalesce(score::text,'')||'|'||coalesce(followups_enviados::text,''), ',' order by id)),'vazio') h
       from leads where organizacao_id=$1`, [org])).rows[0].h
  return { leads, interacoes, checksum }
}

async function listarOrgs(c: Client): Promise<string[]> {
  return (await c.query('select distinct organizacao_id from leads order by 1')).rows.map((r) => r.organizacao_id)
}

interface ResultadoOrg { org: string; empresasCriadas: number; contatosCriados: number; ligados: number; revisao: number }

async function backfillOrg(c: Client, org: string): Promise<ResultadoOrg> {
  await c.query('begin')
  try {
    const eleg = (await c.query(
      `select id, empresa, contato_nome, contato_cargo, contato_email, contato_telefone
         from leads where organizacao_id=$1 and empresa_id is null`, [org])).rows
    const origPorId = new Map(eleg.map((l) => [l.id as string, l]))
    const plano = planejarDedup(eleg.map((l): LeadEntrada => ({ id: l.id, empresa: l.empresa, contato_email: l.contato_email })))

    // find-or-create contra empresas já existentes (idempotência incremental).
    const existentes = (await c.query('select id, nome, cnpj, dominio from empresas where organizacao_id=$1', [org])).rows
    const byCnpj = new Map<string, string>()
    const byNomeDom = new Map<string, string>()
    for (const e of existentes) {
      if (e.cnpj) byCnpj.set(e.cnpj, e.id)
      byNomeDom.set(`${normalizarNomeEmpresa(e.nome)}|${e.dominio ?? ''}`, e.id)
    }

    // agrupa o plano por chave de empresa
    const grupos = new Map<string, typeof plano>()
    for (const p of plano) {
      if (!grupos.has(p.empresaChave)) grupos.set(p.empresaChave, [])
      grupos.get(p.empresaChave)!.push(p)
    }

    let empresasCriadas = 0, contatosCriados = 0, ligados = 0, revisao = 0
    const chaveToEmpresaId = new Map<string, string>()

    for (const [chave, itens] of grupos) {
      const rep = itens[0]
      const leadRep = origPorId.get(rep.leadId)!
      let empresaId: string | undefined
      if (rep.metodo === 'cnpj' && rep.cnpj) empresaId = byCnpj.get(rep.cnpj)
      else if (rep.metodo === 'nome_dominio') empresaId = byNomeDom.get(`${rep.nomeNormalizado}|${rep.dominio ?? ''}`)

      if (!empresaId) {
        const ins = await c.query(
          `insert into empresas (organizacao_id, nome, cnpj, dominio, origem, revisao_pendente, motivo_revisao)
             values ($1,$2,$3,$4,'lead_backfill',$5,$6) returning id`,
          [org, leadRep.empresa, rep.cnpj, rep.dominio, rep.revisaoPendente, rep.motivoRevisao])
        empresaId = ins.rows[0].id as string
        empresasCriadas++
        if (rep.revisaoPendente) revisao++
        if (rep.cnpj) byCnpj.set(rep.cnpj, empresaId)
        if (rep.metodo === 'nome_dominio') byNomeDom.set(`${rep.nomeNormalizado}|${rep.dominio ?? ''}`, empresaId)
      }
      chaveToEmpresaId.set(chave, empresaId)
    }

    for (const p of plano) {
      const l = origPorId.get(p.leadId)!
      const empresaId = chaveToEmpresaId.get(p.empresaChave)!
      const ct = await c.query(
        `insert into contatos (organizacao_id, empresa_id, nome, cargo, email, telefone, origem)
           values ($1,$2,$3,$4,$5,$6,'lead_backfill') returning id`,
        [org, empresaId, l.contato_nome, l.contato_cargo, l.contato_email, l.contato_telefone])
      await c.query('update leads set empresa_id=$1, contato_id=$2 where id=$3 and organizacao_id=$4',
        [empresaId, ct.rows[0].id, l.id, org])
      ligados++
      contatosCriados++
    }

    await c.query('commit')
    return { org, empresasCriadas, contatosCriados, ligados, revisao }
  } catch (e) {
    await c.query('rollback')
    throw e
  }
}

// Rollback idempotente: remove só o que o backfill criou (origem='lead_backfill').
// As FKs ON DELETE SET NULL zeram leads.empresa_id/contato_id automaticamente.
async function rollback(c: Client): Promise<{ contatos: number; empresas: number }> {
  const ct = await c.query(`delete from contatos where origem='lead_backfill'`)
  const em = await c.query(`delete from empresas where origem='lead_backfill'`)
  return { contatos: ct.rowCount ?? 0, empresas: em.rowCount ?? 0 }
}

interface Check { nome: string; ok: boolean }
async function validar(c: Client, antes: Map<string, Snapshot>): Promise<Check[]> {
  const checks: Check[] = []
  const add = (nome: string, ok: boolean) => checks.push({ nome, ok })
  // 1) todo lead elegível ligado (empresa_id e contato_id)
  add('todos os leads têm empresa_id e contato_id',
    (await c.query('select count(*)::int n from leads where empresa_id is null or contato_id is null')).rows[0].n === 0)
  // 2) sem meio-ligado
  add('nenhum lead meio-ligado (empresa xor contato)',
    (await c.query('select count(*)::int n from leads where (empresa_id is null) <> (contato_id is null)')).rows[0].n === 0)
  // 3) sem órfãos: contato do backfill sem empresa; empresa do backfill sem contato
  add('nenhum contato lead_backfill sem empresa',
    (await c.query(`select count(*)::int n from contatos where origem='lead_backfill' and empresa_id is null`)).rows[0].n === 0)
  add('nenhuma empresa lead_backfill sem contato',
    (await c.query(`select count(*)::int n from empresas e where e.origem='lead_backfill' and not exists (select 1 from contatos c where c.empresa_id=e.id)`)).rows[0].n === 0)
  // 4) por org: contagem de leads igual + estado/histórico inalterados
  for (const [org, s0] of antes) {
    const s1 = await snapshot(c, org)
    add(`org ${org.slice(0, 8)}: contagem de leads inalterada (${s0.leads})`, s0.leads === s1.leads)
    add(`org ${org.slice(0, 8)}: estado/pipeline/responsável/próxima-ação inalterados (checksum)`, s0.checksum === s1.checksum)
    add(`org ${org.slice(0, 8)}: histórico (interacoes) inalterado (${s0.interacoes})`, s0.interacoes === s1.interacoes)
  }
  return checks
}

function imprimirChecks(checks: Check[]): boolean {
  for (const c of checks) console.log(`  ${c.ok ? C.grn + '✓' : C.red + '✗'}${C.r} ${c.nome}`)
  const falhas = checks.filter((c) => !c.ok).length
  console.log(falhas === 0 ? `${C.grn}${C.b}\n  ${checks.length}/${checks.length} checks OK${C.r}` : `${C.red}\n  ${falhas} FALHA(S)${C.r}`)
  return falhas === 0
}

async function relatorio(c: Client, titulo: string, orgs: string[]) {
  console.log(`\n${C.b}${titulo}${C.r}`)
  const linhas = []
  for (const org of orgs) {
    const leads = (await c.query('select count(*)::int n from leads where organizacao_id=$1', [org])).rows[0].n
    const semPonte = (await c.query('select count(*)::int n from leads where organizacao_id=$1 and (empresa_id is null or contato_id is null)', [org])).rows[0].n
    const emp = (await c.query('select count(*)::int n from empresas where organizacao_id=$1', [org])).rows[0].n
    const ctt = (await c.query('select count(*)::int n from contatos where organizacao_id=$1', [org])).rows[0].n
    const rev = (await c.query('select count(*)::int n from empresas where organizacao_id=$1 and revisao_pendente', [org])).rows[0].n
    linhas.push({ org: org.slice(0, 8), leads, sem_ponte: semPonte, empresas: emp, contatos: ctt, revisao_pendente: rev })
  }
  console.table(linhas)
}

async function main() {
  const modo = process.argv[2] ?? 'run'
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const orgs = await listarOrgs(c)

    if (modo === 'rollback') {
      const r = await rollback(c)
      console.log(`Rollback: removidas ${r.empresas} empresas e ${r.contatos} contatos (origem=lead_backfill).`)
      await relatorio(c, 'DEPOIS DO ROLLBACK (todas as orgs)', orgs)
      return
    }

    // snapshot ANTES (todas as orgs) para validar imutabilidade
    const antes = new Map<string, Snapshot>()
    for (const org of orgs) antes.set(org, await snapshot(c, org))
    await relatorio(c, 'ANTES (todas as orgs)', orgs)

    const resultados: ResultadoOrg[] = []
    for (const org of orgs) resultados.push(await backfillOrg(c, org))
    console.log(`\n${C.b}Backfill por organização:${C.r}`)
    console.table(resultados.map((r) => ({ org: r.org.slice(0, 8), empresas_criadas: r.empresasCriadas, contatos_criados: r.contatosCriados, leads_ligados: r.ligados, revisao_pendente: r.revisao })))

    await relatorio(c, 'DEPOIS (todas as orgs)', orgs)
    console.log(`\n${C.b}Validação:${C.r}`)
    const okRun = imprimirChecks(await validar(c, antes))
    if (!okRun) process.exit(1)

    if (modo === 'selftest') {
      // idempotência do backfill: rodar de novo não deve criar nada
      const r2 = []
      for (const org of orgs) r2.push(await backfillOrg(c, org))
      const criouAlgo = r2.some((r) => r.empresasCriadas + r.contatosCriados + r.ligados > 0)
      console.log(`\n${C.b}Idempotência do backfill (2ª execução):${C.r} ${criouAlgo ? C.red + 'CRIOU (falha)' : C.grn + 'no-op ✓'}${C.r}`)
      if (criouAlgo) process.exit(1)

      // rollback → valida limpo + leads intactos
      const rb = await rollback(c)
      console.log(`\n${C.b}Rollback:${C.r} removidas ${rb.empresas} empresas / ${rb.contatos} contatos`)
      const limpo: Check[] = []
      limpo.push({ nome: 'empresas lead_backfill = 0', ok: (await c.query(`select count(*)::int n from empresas where origem='lead_backfill'`)).rows[0].n === 0 })
      limpo.push({ nome: 'contatos lead_backfill = 0', ok: (await c.query(`select count(*)::int n from contatos where origem='lead_backfill'`)).rows[0].n === 0 })
      limpo.push({ nome: 'leads com ponte = 0 (rollback zerou)', ok: (await c.query('select count(*)::int n from leads where empresa_id is not null or contato_id is not null')).rows[0].n === 0 })
      for (const [org, s0] of antes) {
        const s1 = await snapshot(c, org)
        limpo.push({ nome: `org ${org.slice(0, 8)}: leads/checksum/histórico intactos pós-rollback`, ok: s0.leads === s1.leads && s0.checksum === s1.checksum && s0.interacoes === s1.interacoes })
      }
      if (!imprimirChecks(limpo)) process.exit(1)

      // rollback idempotente (2ª vez = no-op)
      const rb2 = await rollback(c)
      console.log(`\n${C.b}Rollback idempotente (2ª vez):${C.r} ${rb2.empresas + rb2.contatos === 0 ? C.grn + 'no-op ✓' : C.red + 'removeu algo (falha)'}${C.r}`)
      if (rb2.empresas + rb2.contatos !== 0) process.exit(1)

      // restaura estado backfillado (final)
      for (const org of orgs) await backfillOrg(c, org)
      console.log(`\n${C.grn}${C.b}Selftest OK — DB restaurado ao estado backfillado.${C.r}`)
      if (!imprimirChecks(await validar(c, antes))) process.exit(1)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(C.red + (e?.message ?? e) + C.r); process.exit(1) })
