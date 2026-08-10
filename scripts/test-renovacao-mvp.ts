/**
 * E2E do MVP Renovação (Fases 4.3/4.5) — EFÊMERO, força MODO_ENSAIO=true e NÃO
 * define RENOVACAO_ENVIO_REAL (zero e-mail real). Monta um cenário controlado
 * (na janela / fora / duplicado / outra org) e valida: relatório dryRun (sem
 * escrever), execução real (cria tarefa/notif, sem enviar), idempotência,
 * isolamento entre organizações. Limpa tudo. Imprime o RELATÓRIO de ensaio.
 *   npx tsx scripts/test-renovacao-mvp.ts
 */
process.env.MODO_ENSAIO = 'true'
delete process.env.RENOVACAO_ENVIO_REAL
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { processarRenovacoes } from '../lib/renovacao/processar'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = '03097614-9fd5-4491-a91c-589f84461683' // Laudos
const ORG2 = '00000000-0000-0000-0000-000000000001' // Padrão (isolamento)
const MARK = 'r45_test'
const res: [boolean, string][] = []
const ok = (n: string, v: boolean) => { res.push([v, n]); if (!v) console.error('FAIL ' + n) }

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  const ids: string[] = []
  const mkEmp = async (org: string, nome: string) => (await c.query(`insert into empresas(organizacao_id,nome,origem) values($1,$2,$3) returning id`, [org, nome, MARK])).rows[0].id
  const mkLead = async (org: string, emp: string, email: string) => (await c.query(`insert into leads(organizacao_id,empresa,contato_nome,contato_email,empresa_id,owner,estagio,perdido,origem) values($1,'__R45__','C',$2,$3,'n8n','novos_leads',false,$4) returning id`, [org, email, emp, MARK])).rows[0].id
  const mkSvc = async (org: string, emp: string, dias: number) => (await c.query(`insert into servicos_recorrentes(organizacao_id,empresa_id,tipo,realizado_em,periodicidade_valor,periodicidade_unidade,status,origem) values($1,$2,'laudo',current_date,$3,'dias','vigente',$4) returning id`, [org, emp, dias, MARK])).rows[0].id
  try {
    // Cenário Laudos: S1 na janela (venc +10), S2 fora (+200), S3 na janela mas com tarefa aberta (dup)
    const E1 = await mkEmp(ORG, '__R45__ E1'); const L1 = await mkLead(ORG, E1, 'e1@r45.invalid'); const S1 = await mkSvc(ORG, E1, 10)
    const E2 = await mkEmp(ORG, '__R45__ E2'); await mkLead(ORG, E2, 'e2@r45.invalid'); await mkSvc(ORG, E2, 200)
    const E3 = await mkEmp(ORG, '__R45__ E3'); const L3 = await mkLead(ORG, E3, 'e3@r45.invalid'); const S3 = await mkSvc(ORG, E3, 10)
    await c.query(`insert into tarefas(organizacao_id,servico_id,empresa_id,lead_id,tipo,titulo,status,origem) values($1,$2,$3,$4,'renovacao','pre','aberta','renovacao')`, [ORG, S3, E3, L3])
    // Outra org (isolamento): S4 na janela
    const E4 = await mkEmp(ORG2, '__R45__ E4'); const S4 = await mkSvc(ORG2, E4, 10)
    ids.push(L1, L3)

    // 1) RELATÓRIO dryRun (não escreve)
    const tarefasAntes = (await c.query(`select count(*)::int n from tarefas where origem='renovacao' and empresa_id in ($1,$2,$3)`, [E1, E2, E3])).rows[0].n
    const rep = await processarRenovacoes(ORG, { dryRun: true })
    ok('dryRun: avaliados >= 3', rep.avaliados >= 3)
    ok('dryRun: naJanela = 2 (S1,S3; S2 fora)', rep.naJanela === 2)
    ok('dryRun: tarefas que seriam criadas = 1 (S3 é dup)', rep.tarefas === 1)
    ok('dryRun: duplicações evitadas = 1', rep.duplicacoesEvitadas === 1)
    ok('dryRun: mensagens = 0 (sem RENOVACAO_ENVIO_REAL)', rep.mensagens === 0)
    ok('dryRun NÃO escreveu (contagem de tarefas inalterada)', (await c.query(`select count(*)::int n from tarefas where origem='renovacao' and empresa_id in ($1,$2,$3)`, [E1, E2, E3])).rows[0].n === tarefasAntes)
    console.log('\n=== RELATÓRIO DE ENSAIO (dryRun, cenário controlado) ===')
    console.log({ avaliados: rep.avaliados, naJanela: rep.naJanela, tarefas: rep.tarefas, notificacoes: rep.notificacoes, mensagens: rep.mensagens, duplicacoesEvitadas: rep.duplicacoesEvitadas })
    console.table(rep.itens.map((i) => ({ empresa: i.empresa, vence: i.vencimento, dias: i.dias, jaTem: i.jaTemTarefa, dest_msg: i.destinatarioMensagem })))

    // 2) EXECUÇÃO real (cria tarefa/notif; NÃO envia)
    const r1 = await processarRenovacoes(ORG, {})
    ok('run: criou 1 tarefa (S1)', r1.tarefas === 1)
    ok('run: 0 mensagens reais', r1.mensagens === 0)
    ok('tarefa de S1 existe (aparece em Minhas Tarefas)', (await c.query(`select count(*)::int n from tarefas where servico_id=$1 and tipo='renovacao'`, [S1])).rows[0].n === 1)
    ok('notificação de S1 criada', (await c.query(`select count(*)::int n from notificacoes where origem='renovacao' and lead_id=$1`, [L1])).rows[0].n >= 1)
    ok('execução no histórico (interacoes.motivo=renovacao)', (await c.query(`select count(*)::int n from interacoes where lead_id=$1 and motivo='renovacao'`, [L1])).rows[0].n >= 1)

    // 3) ISOLAMENTO entre orgs: run de Laudos NÃO cria tarefa para o serviço da outra org
    ok('isolamento: serviço da outra org NÃO recebeu tarefa', (await c.query(`select count(*)::int n from tarefas where servico_id=$1`, [S4])).rows[0].n === 0)

    // 4) IDEMPOTÊNCIA
    const r2 = await processarRenovacoes(ORG, {})
    ok('idempotente: 2ª execução não cria tarefa', r2.tarefas === 0 && r2.duplicacoesEvitadas >= 2)
    ok('sem tarefa duplicada de S1', (await c.query(`select count(*)::int n from tarefas where servico_id=$1 and tipo='renovacao'`, [S1])).rows[0].n === 1)
  } finally {
    for (const L of ids) { await c.query(`delete from interacoes where lead_id=$1`, [L]) }
    await c.query(`delete from tarefas where empresa_id in (select id from empresas where origem=$1)`, [MARK])
    await c.query(`delete from servicos_recorrentes where origem=$1`, [MARK])
    await c.query(`delete from leads where origem=$1`, [MARK])
    await c.query(`delete from empresas where origem=$1`, [MARK])
    await c.end()
  }
  console.table(res.map(([r, n]) => ({ r: r ? 'PASS' : 'FAIL', teste: n })))
  const f = res.filter((x) => !x[0]).length
  console.log(f ? `${f} FALHA(S)` : `TODOS ${res.length} OK`)
  process.exit(f ? 1 : 0)
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
