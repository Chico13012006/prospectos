/**
 * E2E do MVP Renovação (Fase 4.3) — EFÊMERO, força MODO_ENSAIO=true e simular
 * (nunca envia e-mail real). Setup/asserts/cleanup via pg; o processador usa o
 * supabase-admin (mesmo banco). Cria empresa+lead+serviço na janela, roda o
 * processador e valida tarefa/notificação/execução + idempotência. Limpa tudo.
 *   npx tsx scripts/test-renovacao-mvp.ts
 */
process.env.MODO_ENSAIO = 'true' // segurança: força ensaio (getters leem em call-time)
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { processarRenovacoes } from '../lib/renovacao/processar'

function carregarEnv() {
  for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
    const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
    const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

const ORG = '03097614-9fd5-4491-a91c-589f84461683'
const MARK = 'renov_test'
const res: [boolean, string][] = []
const ok = (n: string, v: boolean) => { res.push([v, n]); if (!v) console.error('FAIL ' + n) }

async function main() {
  carregarEnv()
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
  let E = '', L = '', S = ''
  try {
    E = (await c.query(`insert into empresas(organizacao_id,nome,origem) values($1,'__RENOV__ Emp',$2) returning id`, [ORG, MARK])).rows[0].id
    L = (await c.query(`insert into leads(organizacao_id,empresa,contato_nome,contato_email,empresa_id,owner,estagio,perdido,origem) values($1,'__RENOV__ Emp','Contato','renov@example.invalid',$2,'n8n','novos_leads',false,$3) returning id`, [ORG, E, MARK])).rows[0].id
    S = (await c.query(`insert into servicos_recorrentes(organizacao_id,empresa_id,tipo,realizado_em,periodicidade_valor,periodicidade_unidade,status,origem) values($1,$2,'laudo',current_date,10,'dias','vigente',$3) returning id`, [ORG, E, MARK])).rows[0].id

    const r1 = await processarRenovacoes(ORG, { simular: true })
    ok('processou >=1 candidato', r1.candidatos >= 1)
    ok('criou a tarefa de renovação', r1.tarefasCriadas >= 1)
    ok('simular => 0 mensagens reais', r1.mensagens === 0)
    const tar = (await c.query(`select prioridade,origem from tarefas where servico_id=$1 and tipo='renovacao'`, [S])).rows
    ok('tarefa: prioridade=alta, origem=renovacao', tar.length === 1 && tar[0].prioridade === 'alta' && tar[0].origem === 'renovacao')
    ok('notificação de renovação criada', (await c.query(`select count(*)::int n from notificacoes where lead_id=$1 and origem='renovacao'`, [L])).rows[0].n >= 1)
    ok('execução no histórico (interacoes.motivo=renovacao)', (await c.query(`select count(*)::int n from interacoes where lead_id=$1 and motivo='renovacao'`, [L])).rows[0].n >= 1)

    const r2 = await processarRenovacoes(ORG, { simular: true })
    ok('idempotente: 2ª execução não cria tarefa', r2.tarefasCriadas === 0 && r2.pulados >= 1)
    ok('sem tarefa duplicada', (await c.query(`select count(*)::int n from tarefas where servico_id=$1 and tipo='renovacao'`, [S])).rows[0].n === 1)
  } finally {
    if (L) {
      await c.query(`delete from interacoes where lead_id=$1`, [L])
      await c.query(`delete from tarefas where lead_id=$1`, [L])
    }
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
