/**
 * Fase 2e — validação de consistência leads × empresas × contatos (TODAS as orgs),
 * prova de equivalência (o adapter de leitura devolve os MESMOS dados que a tela
 * legada), monitoramento do trigger e teste de desempenho. Somente leitura,
 * exceto o teste de desempenho (linhas efêmeras marcadas, apagadas no fim).
 *
 *   npx tsx scripts/validar-consistencia-2e.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { montarEmpresaView, montarContatoView, type LeadCompat, type EmpresaRow, type ContatoRow } from '../lib/empresas/view'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  for (const l of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
    const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}
carregarEnvLocal()
const MARK = 'perf_2e'

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  try {
    const orgs = (await c.query('select distinct organizacao_id from leads order by 1')).rows.map((r) => r.organizacao_id)

    // ===== 1) RELATÓRIO DE DIVERGÊNCIAS (tabelas subjacentes) — todas as orgs =====
    console.log('\n=== 1) DIVERGÊNCIAS leads × entidades (por org) ===')
    const campos = ['empresa|nome', 'cidade|cidade', 'estado|estado', 'segmento|segmento', 'dominio|dominio']
    const relatorio: Record<string, unknown>[] = []
    for (const org of orgs) {
      const linhas = (await c.query(
        `select l.id, l.empresa,l.cidade,l.estado,l.segmento,l.dominio,l.contato_email,l.contato_nome,
                e.nome e_nome, e.cidade e_cidade, e.estado e_estado, e.segmento e_segmento, e.dominio e_dominio,
                ct.email c_email, ct.nome c_nome
           from leads l
           left join empresas e on e.id=l.empresa_id
           left join contatos ct on ct.id=l.contato_id
          where l.organizacao_id=$1 and l.empresa_id is not null`, [org])).rows
      let divEmpresaNome = 0, divContatoEmail = 0
      for (const r of linhas) {
        if ((r.empresa ?? '') !== (r.e_nome ?? '')) divEmpresaNome++
        if ((r.contato_email ?? '') !== (r.c_email ?? '')) divContatoEmail++
      }
      relatorio.push({ org: org.slice(0, 8), leads_ligados: linhas.length, div_empresa_nome: divEmpresaNome, div_contato_email: divContatoEmail })
    }
    console.table(relatorio)
    console.log('Nota: divergência na tabela empresa é esperada onde o backfill mesclou nomes com grafias diferentes;')
    console.log('a camada de leitura usa o LEAD como fonte, então a tela mostra o valor do lead (ver equivalência abaixo).')

    // ===== 2) PROVA DE EQUIVALÊNCIA (adapter == legado) — todas as orgs =====
    console.log('\n=== 2) EQUIVALÊNCIA adapter (view) × leitura legada (campos que a tela mostra) ===')
    let totalLeads = 0, difEmpresa = 0, difContato = 0
    const exemplos: Record<string, unknown>[] = []
    for (const org of orgs) {
      const rows = (await c.query(
        `select l.*, e.* , ct.*,
                l.id as lead_id
           from leads l
           left join empresas e on e.id=l.empresa_id
           left join contatos ct on ct.id=l.contato_id
          where l.organizacao_id=$1`, [org])).rows
      for (const r of rows) {
        totalLeads++
        const lead = r as unknown as LeadCompat
        const empresa = (r.empresa_id ? r : null) as unknown as EmpresaRow | null
        const contato = (r.contato_id ? r : null) as unknown as ContatoRow | null
        const ev = montarEmpresaView(lead, empresa)
        const cv = montarContatoView(lead, contato)
        // Campos que a tela mostra hoje (legado) = colunas de leads.
        const empresaLegado = r.empresa ?? null
        const emailLegado = r.contato_email ?? null
        if ((ev.nome ?? null) !== (empresaLegado ?? null)) { difEmpresa++; if (exemplos.length < 5) exemplos.push({ lead: r.lead_id, view: ev.nome, legado: empresaLegado }) }
        if ((cv.email ?? null) !== (emailLegado ?? null)) difContato++
      }
    }
    console.log(`Leads avaliados: ${totalLeads}`)
    console.log(`Diferenças no NOME DA EMPRESA exibido (view × legado): ${difEmpresa}`)
    console.log(`Diferenças no EMAIL DO CONTATO exibido (view × legado): ${difContato}`)
    if (exemplos.length) console.table(exemplos)
    const equivOk = difEmpresa === 0 && difContato === 0
    console.log(equivOk ? '✓ EQUIVALÊNCIA TOTAL: nenhuma tela mostraria dado diferente ao ligar o adapter.' : '✗ há diferenças — investigar antes de ligar.')

    // ===== 3) MONITORAMENTO DO TRIGGER =====
    console.log('\n=== 3) MONITORAMENTO DO TRIGGER ===')
    const trg = (await c.query(`select tgenabled from pg_trigger where tgrelid='leads'::regclass and tgname='trg_sync_lead_entidades'`)).rows[0]
    console.log('trigger trg_sync_lead_entidades:', trg ? `presente (tgenabled=${trg.tgenabled})` : 'AUSENTE ✗')
    const mon = (await c.query(
      `select 'empresas' t, count(*) filter (where sync_em is not null)::int sincronizadas, count(*)::int total, max(sync_em) ultimo from empresas
        union all select 'contatos', count(*) filter (where sync_em is not null)::int, count(*)::int, max(sync_em) from contatos`)).rows
    console.table(mon)

    // ===== 4) TESTE DE DESEMPENHO (overhead do trigger) =====
    console.log('\n=== 4) DESEMPENHO (overhead do trigger) ===')
    const org0 = orgs[0]
    const E = (await c.query(`insert into empresas(organizacao_id,nome,origem) values($1,'__PERF__',$2) returning id`, [org0, MARK])).rows[0].id
    const CT = (await c.query(`insert into contatos(organizacao_id,empresa_id,nome,email,origem) values($1,$2,'p','p@perf',$3) returning id`, [org0, E, MARK])).rows[0].id
    const mk = async () => (await c.query(`insert into leads(organizacao_id,empresa,contato_nome,contato_email,empresa_id,contato_id,owner,estagio,perdido,origem) values($1,'__PERF__','p','p@perf',$2,$3,'n8n','novos_leads',false,$4) returning id`, [org0, E, CT, MARK])).rows[0].id
    const Lp = await mk(); await mk() // 2 leads (para exercitar propagação ao irmão)
    const N = 200
    const t0 = Date.now()
    for (let i = 0; i < N; i++) await c.query(`update leads set contato_email=$1 where id=$2`, [`p${i}@perf`, Lp]) // dispara sync
    const comSync = Date.now() - t0
    const t1 = Date.now()
    for (let i = 0; i < N; i++) await c.query(`update leads set score=$1 where id=$2`, [i, Lp]) // não dispara sync
    const semSync = Date.now() - t1
    console.table([
      { cenario: `${N}x update com sync (campo core)`, ms_total: comSync, ms_por_update: +(comSync / N).toFixed(2) },
      { cenario: `${N}x update sem sync (só pipeline)`, ms_total: semSync, ms_por_update: +(semSync / N).toFixed(2) },
      { cenario: 'overhead médio do trigger/update', ms_por_update: +((comSync - semSync) / N).toFixed(2) },
    ])

    console.log(`\n${equivOk && !!trg ? 'VALIDAÇÃO 2E OK' : 'VALIDAÇÃO 2E COM PENDÊNCIAS'}`)
    process.exitCode = equivOk && !!trg ? 0 : 1
  } finally {
    await c.query(`delete from leads where origem=$1`, [MARK])
    await c.query(`delete from contatos where origem=$1`, [MARK])
    await c.query(`delete from empresas where origem=$1`, [MARK])
    await c.end()
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
