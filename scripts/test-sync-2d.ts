/**
 * Teste E2E do write-sync (Fase 2d, migration 0018) — EFÊMERO e com limpeza.
 * Cria um cenário próprio (marcado origem='test_sync_2d') na org padrão, exercita
 * o trigger e APAGA tudo no fim (mesmo se falhar). Não toca dados de produção.
 *
 *   npx tsx scripts/test-sync-2d.ts
 *
 * Cobre: sync do contato ligado (com múltiplos contatos na empresa), campos
 * compartilhados da empresa + consistência dos leads irmãos, ausência de efeito
 * colateral em pipeline/histórico, escrita só-pipeline não dispara sync,
 * rollback integral em falha parcial, e concorrência.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  for (const l of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
    const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}
carregarEnvLocal()

const ORG = '00000000-0000-0000-0000-000000000001'
const MARK = 'test_sync_2d'
const results: [boolean, string][] = []
const ok = (nome: string, cond: boolean) => { results.push([cond, nome]); if (!cond) console.error('   FAIL: ' + nome) }

async function limpar(c: pg.Client) {
  await c.query(`delete from interacoes where lead_id in (select id from leads where origem=$1)`, [MARK])
  await c.query(`delete from leads where origem=$1`, [MARK])
  await c.query(`delete from contatos where origem=$1`, [MARK])
  await c.query(`delete from empresas where origem=$1`, [MARK])
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  const A = new pg.Client({ connectionString: process.env.DATABASE_URL })
  const B = new pg.Client({ connectionString: process.env.DATABASE_URL })
  try {
    await limpar(c) // pre-limpeza defensiva

    // ---- setup ----
    const E = (await c.query(`insert into empresas(organizacao_id,nome,dominio,origem) values($1,'__SYNC2D__ Empresa','sync2d.com',$2) returning id`, [ORG, MARK])).rows[0].id
    const C1 = (await c.query(`insert into contatos(organizacao_id,empresa_id,nome,email,origem) values($1,$2,'C1','c1@sync2d.com',$3) returning id`, [ORG, E, MARK])).rows[0].id
    const C2 = (await c.query(`insert into contatos(organizacao_id,empresa_id,nome,email,origem) values($1,$2,'C2','c2@sync2d.com',$3) returning id`, [ORG, E, MARK])).rows[0].id
    const mkLead = async (contato: string, contatoEmail: string, estagio: string, score: number) =>
      (await c.query(
        `insert into leads(organizacao_id,empresa,cidade,estado,segmento,contato_nome,contato_email,empresa_id,contato_id,owner,estagio,score,proxima_acao,responsavel_nome,perdido,origem)
         values($1,'__SYNC2D__ Empresa','Rio','RJ','Óticas',$2,$3,$4,$5,'n8n',$6,$7,'ligar','Fulano',false,$8) returning id`,
        [ORG, contato, contatoEmail, E, contato === 'C1' ? C1 : C2, estagio, score, MARK])).rows[0].id
    const L1 = await mkLead('C1', 'c1@sync2d.com', 'novos_leads', 50)
    const L2 = await mkLead('C2', 'c2@sync2d.com', 'follow_up', 70)
    await c.query(`insert into interacoes(organizacao_id,lead_id,tipo,canal,descricao,origem_acao) values($1,$2,'nota','sistema','hist',$3)`, [ORG, L2, 'humano'])

    const empresa = async () => (await c.query('select * from empresas where id=$1', [E])).rows[0]
    const contato = async (id: string) => (await c.query('select * from contatos where id=$1', [id])).rows[0]
    const lead = async (id: string) => (await c.query('select * from leads where id=$1', [id])).rows[0]

    // ---- Teste 1: sync do contato ligado; outros contatos da empresa intactos ----
    await c.query(`update leads set contato_email='novo1@sync2d.com', contato_nome='C1 Novo' where id=$1`, [L1])
    const c1 = await contato(C1), c2 = await contato(C2)
    ok('contato ligado sincronizado (email/nome)', c1.email === 'novo1@sync2d.com' && c1.nome === 'C1 Novo')
    ok('auditoria de origem gravada no contato', c1.sync_origem_lead_id === L1 && c1.sync_em !== null)
    ok('outro contato da MESMA empresa intacto (multi-contato)', c2.email === 'c2@sync2d.com' && c2.nome === 'C2')

    // ---- Teste 2: empresa compartilhada + irmãos + sem efeito em pipeline/histórico ----
    const l2antes = await lead(L2)
    const histAntes = (await c.query('select count(*)::int n from interacoes where lead_id=$1', [L2])).rows[0].n
    await c.query(`update leads set empresa='__SYNC2D__ Renomeada', cidade='Curitiba', estado='PR' where id=$1`, [L1])
    const emp = await empresa(), l2 = await lead(L2)
    ok('empresa atualizada (nome/cidade/estado)', emp.nome === '__SYNC2D__ Renomeada' && emp.cidade === 'Curitiba' && emp.estado === 'PR')
    ok('auditoria de origem gravada na empresa', emp.sync_origem_lead_id === L1)
    ok('lead IRMÃO recebeu os campos compartilhados (consistência)', l2.empresa === '__SYNC2D__ Renomeada' && l2.cidade === 'Curitiba' && l2.estado === 'PR')
    ok('lead irmão: pipeline INALTERADO (estagio/score/proxima_acao/responsavel)',
      l2.estagio === l2antes.estagio && l2.score === l2antes.score && l2.proxima_acao === l2antes.proxima_acao && l2.responsavel_nome === l2antes.responsavel_nome)
    ok('lead irmão: histórico INALTERADO', (await c.query('select count(*)::int n from interacoes where lead_id=$1', [L2])).rows[0].n === histAntes)

    // ---- Teste 3: escrita só de pipeline NÃO dispara sync ----
    const empSyncEm = (await empresa()).sync_em, c1SyncEm = (await contato(C1)).sync_em
    await c.query(`update leads set estagio='interessado', score=88, proxima_acao='y' where id=$1`, [L1])
    ok('update só-pipeline NÃO ressincroniza empresa', String((await empresa()).sync_em) === String(empSyncEm))
    ok('update só-pipeline NÃO ressincroniza contato', String((await contato(C1)).sync_em) === String(c1SyncEm))

    // ---- Teste 4: rollback INTEGRAL em falha parcial ----
    await c.query('begin')
    await c.query(`alter table contatos add constraint tmp_chk_sync2d check (email <> 'FAIL@sync2d')`)
    await c.query('savepoint sp')
    let falhou = false
    try { await c.query(`update leads set contato_email='FAIL@sync2d' where id=$1`, [L1]) }
    catch { falhou = true; await c.query('rollback to savepoint sp') }
    ok('update que faz o sync violar constraint FALHA (atomicidade)', falhou)
    const l1apos = await lead(L1), c1apos = await contato(C1)
    ok('rollback integral: lead NÃO mudou', l1apos.contato_email === 'novo1@sync2d.com')
    ok('rollback integral: contato NÃO mudou', c1apos.email === 'novo1@sync2d.com')
    await c.query('rollback') // remove a constraint temporária

    // ---- Teste 5: concorrência (2 conexões no MESMO lead) → serializa e converge ----
    await A.connect(); await B.connect()
    await A.query('begin')
    await A.query(`update leads set empresa='CONC_A', cidade='CA' where id=$1`, [L1])
    const bp = (async () => { await B.query('begin'); await B.query(`update leads set empresa='CONC_B', cidade='CB' where id=$1`, [L1]); await B.query('commit') })()
    await new Promise((r) => setTimeout(r, 250)) // deixa B bloquear no lock de linha
    await A.query('commit')
    await bp
    const empF = await empresa(), l1F = await lead(L1), l2F = await lead(L2)
    ok('concorrência serializou (último commit venceu)', empF.nome === 'CONC_B' && empF.cidade === 'CB')
    ok('concorrência: sem versões divergentes (empresa == todos os leads irmãos)',
      empF.nome === l1F.empresa && empF.nome === l2F.empresa && empF.cidade === l1F.cidade && empF.cidade === l2F.cidade)

    console.log('\n== RESULTADO ==')
    console.table(results.map(([s, n]) => ({ r: s ? 'PASS' : 'FAIL', teste: n })))
    const falhas = results.filter((r) => !r[0]).length
    console.log(falhas === 0 ? `\nTODOS OS ${results.length} CHECKS PASSARAM` : `\n${falhas} FALHA(S)`)
    process.exitCode = falhas === 0 ? 0 : 1
  } finally {
    try { await A.end() } catch {}
    try { await B.end() } catch {}
    await limpar(c)
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
