/**
 * Reconciliação da projeção Empresa × Contato (acabamento da Fase 2).
 * ---------------------------------------------------------------------------
 * O write-sync 2d (trigger trg_sync_lead_entidades) converge a projeção
 * empresas/contatos com o LEAD autoritativo — mas SÓ no próximo UPDATE de um
 * campo core do lead. Enquanto ninguém edita, sobra o resíduo do backfill 2b
 * (grafias mescladas): `empresas.nome`/campos de contato velhos na projeção.
 * Este script força AGORA a convergência que o trigger faria, de forma
 * CONSERVADORA e idempotente, mexendo SÓ na projeção (empresas/contatos),
 * NUNCA em `leads` (a fonte autoritativa fica intocada).
 *
 * Regras (fiéis ao trigger 0018, sem tomar decisão de dado ambígua):
 *   - CONTATO (1:1 com o lead ligado): se algum campo core (nome/cargo/email/
 *     telefone) diverge do lead, converge a projeção para o valor do lead.
 *     Sempre seguro — não há ambiguidade num vínculo 1:1.
 *   - EMPRESA (1:N leads): só converge quando TODOS os leads irmãos concordam
 *     nos campos compartilhados (nome/cidade/estado/segmento/site/dominio) e só
 *     a projeção está velha. Quando os irmãos DISCORDAM entre si, é ambíguo
 *     (qual grafia é a certa?) — NÃO toca; apenas reporta. O trigger resolveria
 *     por "último edit vence" sobrescrevendo os leads irmãos; forçar isso seria
 *     uma decisão de qualidade de dado que este acabamento não deve tomar.
 *
 * Audita a origem igual ao trigger (sync_origem_lead_id + sync_em) e toca
 * atualizado_em. Só escreve onde REALMENTE diverge (is distinct from) => no-op
 * na 2ª execução.
 *
 *   npx tsx scripts/reconciliar-projecao-entidades.ts          # report (dry-run, NÃO escreve)
 *   npx tsx scripts/reconciliar-projecao-entidades.ts apply     # aplica a convergência segura
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

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

const C = { grn: '\x1b[32m', red: '\x1b[31m', ylw: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', r: '\x1b[0m' }
type Client = pg.Client

// Campos compartilhados de empresa (mesma lista do trigger 0018).
const EMPRESA_CORE = ['empresa', 'cidade', 'estado', 'segmento', 'site', 'dominio'] as const

async function listarOrgs(c: Client): Promise<string[]> {
  return (await c.query('select distinct organizacao_id from leads order by 1')).rows.map((r) => r.organizacao_id)
}

const eq = (a: unknown, b: unknown) => (a ?? '') === (b ?? '')
const chaveDe = (r: Record<string, unknown>, campos: readonly string[]) => campos.map((f) => String(r[f] ?? '')).join('')

interface Plano {
  contatos: { contatoId: string; leadId: string; org: string; nome: unknown; cargo: unknown; email: unknown; telefone: unknown }[]
  empresasSeguras: { empresaId: string; leadId: string; org: string; valores: Record<string, unknown> }[]
  empresasAmbiguas: { empresaId: string; org: string; grafias: string[] }[]
}

async function planejar(c: Client, org: string): Promise<Plano> {
  const plano: Plano = { contatos: [], empresasSeguras: [], empresasAmbiguas: [] }

  // ---- CONTATOS (1:1): projeção velha vs lead ligado ----
  const ct = (await c.query(
    `select l.id lead_id, ct.id contato_id,
            l.contato_nome, l.contato_cargo, l.contato_email, l.contato_telefone,
            ct.nome, ct.cargo, ct.email, ct.telefone
       from leads l join contatos ct on ct.id = l.contato_id
      where l.organizacao_id = $1`, [org])).rows
  for (const r of ct) {
    if (!eq(r.contato_nome, r.nome) || !eq(r.contato_cargo, r.cargo) || !eq(r.contato_email, r.email) || !eq(r.contato_telefone, r.telefone)) {
      plano.contatos.push({ contatoId: r.contato_id, leadId: r.lead_id, org, nome: r.contato_nome, cargo: r.contato_cargo, email: r.contato_email, telefone: r.contato_telefone })
    }
  }

  // ---- EMPRESAS (1:N): agrupa leads irmãos por empresa ----
  const emp = (await c.query(
    `select e.id empresa_id, e.nome, e.cidade e_cidade, e.estado e_estado, e.segmento e_segmento, e.site e_site, e.dominio e_dominio,
            l.id lead_id, l.empresa, l.cidade, l.estado, l.segmento, l.site, l.dominio
       from empresas e join leads l on l.empresa_id = e.id
      where e.organizacao_id = $1
      order by e.id`, [org])).rows

  const porEmpresa = new Map<string, typeof emp>()
  for (const r of emp) {
    if (!porEmpresa.has(r.empresa_id)) porEmpresa.set(r.empresa_id, [] as unknown as typeof emp)
    porEmpresa.get(r.empresa_id)!.push(r)
  }

  for (const [empresaId, linhas] of porEmpresa) {
    // grafia = tupla dos campos compartilhados de cada lead irmão
    const tuplas = new Map<string, typeof linhas[number]>()
    for (const l of linhas) {
      const chave = chaveDe(l, EMPRESA_CORE)
      if (!tuplas.has(chave)) tuplas.set(chave, l)
    }
    // valores ATUAIS da projeção (e.nome corresponde a leads.empresa; demais e_<campo>)
    const proj = linhas[0] // campos e_* são iguais em todas as linhas da mesma empresa
    const projValores: Record<string, unknown> = { empresa: proj.nome, cidade: proj.e_cidade, estado: proj.e_estado, segmento: proj.e_segmento, site: proj.e_site, dominio: proj.e_dominio }
    const projChave = chaveDe(projValores, EMPRESA_CORE)

    if (tuplas.size > 1) {
      // irmãos discordam => ambíguo, não toca (mostra as grafias do campo `empresa`)
      plano.empresasAmbiguas.push({ empresaId, org, grafias: [...tuplas.values()].map((l) => String(l.empresa ?? '')) })
      continue
    }
    // irmãos concordam (1 tupla). Converge só se a projeção estiver velha.
    const [siblingKey, lead] = [...tuplas.entries()][0]
    if (projChave !== siblingKey) {
      const valores: Record<string, unknown> = {}
      for (const f of EMPRESA_CORE) valores[f] = lead[f]
      plano.empresasSeguras.push({ empresaId, leadId: lead.lead_id, org, valores })
    }
  }

  return plano
}

async function aplicar(c: Client, plano: Plano) {
  for (const x of plano.contatos) {
    await c.query(
      `update contatos set nome=$1, cargo=$2, email=$3, telefone=$4,
              atualizado_em=now(), sync_origem_lead_id=$5, sync_em=now()
        where id=$6 and organizacao_id=$7`,
      [x.nome, x.cargo, x.email, x.telefone, x.leadId, x.contatoId, x.org])
  }
  for (const x of plano.empresasSeguras) {
    await c.query(
      `update empresas set nome=$1, cidade=$2, estado=$3, segmento=$4, site=$5, dominio=$6,
              atualizado_em=now(), sync_origem_lead_id=$7, sync_em=now()
        where id=$8 and organizacao_id=$9`,
      [x.valores.empresa, x.valores.cidade, x.valores.estado, x.valores.segmento, x.valores.site, x.valores.dominio, x.leadId, x.empresaId, x.org])
  }
}

async function main() {
  const modo = process.argv[2] ?? 'report'
  if (!['report', 'apply'].includes(modo)) { console.error(`modo inválido: ${modo} (use report|apply)`); process.exit(1) }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const orgs = await listarOrgs(c)
    let totCt = 0, totEmp = 0, totAmb = 0
    const resumo: Record<string, unknown>[] = []
    const planos: Plano[] = []
    for (const org of orgs) {
      const p = await planejar(c, org)
      planos.push(p)
      totCt += p.contatos.length; totEmp += p.empresasSeguras.length; totAmb += p.empresasAmbiguas.length
      resumo.push({ org: org.slice(0, 8), contatos_a_convergir: p.contatos.length, empresas_a_convergir: p.empresasSeguras.length, empresas_ambiguas_skip: p.empresasAmbiguas.length })
    }
    console.log(`\n${C.b}Divergências de projeção (por org):${C.r}`)
    console.table(resumo)

    // amostra das ambíguas (para inspeção humana, não são tocadas)
    const amostrasAmb = planos.flatMap((p) => p.empresasAmbiguas).slice(0, 8)
    if (amostrasAmb.length) {
      console.log(`${C.ylw}Empresas AMBÍGUAS (leads irmãos com grafias diferentes) — NÃO tocadas:${C.r}`)
      console.table(amostrasAmb.map((a) => ({ empresa: a.empresaId.slice(0, 8), org: a.org.slice(0, 8), grafias: a.grafias.join(' | ').slice(0, 80) })))
    }

    if (modo === 'report') {
      console.log(`\n${C.dim}(dry-run — nada foi escrito. Rode com 'apply' para convergir os ${totCt} contatos + ${totEmp} empresas seguras.)${C.r}`)
      return
    }

    // apply — tudo numa transação
    await c.query('begin')
    try {
      for (const p of planos) await aplicar(c, p)
      await c.query('commit')
    } catch (e) { await c.query('rollback'); throw e }

    // re-verifica: convergência segura deve ir a 0
    let sobra = 0
    for (const org of orgs) { const p = await planejar(c, org); sobra += p.contatos.length + p.empresasSeguras.length }
    console.log(`\n${C.grn}${C.b}Aplicado:${C.r} ${totCt} contatos + ${totEmp} empresas convergidos.`)
    console.log(sobra === 0
      ? `${C.grn}✓ Reverificação: 0 divergências seguras restantes (idempotente).${C.r}`
      : `${C.red}✗ ainda restam ${sobra} divergências seguras — investigar.${C.r}`)
    if (totAmb) console.log(`${C.ylw}${totAmb} empresa(s) ambígua(s) deixadas como estão (leads irmãos discordam; requer decisão humana).${C.r}`)
    process.exitCode = sobra === 0 ? 0 : 1
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(C.red + (e?.message ?? e) + C.r); process.exit(1) })
