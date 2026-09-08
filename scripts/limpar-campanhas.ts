/**
 * Apaga TODAS as campanhas de TODAS as organizações, com os artefatos que só
 * existem por causa delas.
 *
 * O que sai:
 *   • campanhas
 *   • workflow_execucoes com campanha_id preenchido, e seus eventos
 *   • workflows materializados por campanha ("Campanha — <nome>") e suas versões,
 *     desde que não sobre nenhuma execução apontando para eles
 *   • templates materializados por campanha (tipo começando em "campanha_")
 *   • interações DUPLICADAS (mesmo lead + tipo + descrição), preservando a primeira
 *
 * O que FICA, de propósito:
 *   • leads e a ficha real de cada um (envios, respostas e notas legítimas)
 *   • execuções de workflow avulsas (campanha_id nulo) e os workflows autorais
 *   • notas de bounce, que são o registro de por que um lead saiu da esteira
 *
 * Grava um backup JSON em backups/ antes de qualquer DELETE, e roda tudo numa
 * transação: ou apaga o conjunto inteiro, ou não apaga nada.
 *
 * ENSAIO por padrão — sem --confirmar só mostra o que sairia.
 *
 * Uso:
 *   npx tsx scripts/limpar-campanhas.ts
 *   npx tsx scripts/limpar-campanhas.ts --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const LIMITE_CAMPANHAS = 100 // acima disto não é limpeza de teste; revise antes

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  try {
    const campanhas = (await c.query(`select id, organizacao_id, nome, status, workflow_id from campanhas order by criado_em`)).rows
    const execucoes = (await c.query(`select * from workflow_execucoes where campanha_id is not null`)).rows
    const eventos = (await c.query(`
      select e.* from workflow_execucao_eventos e
      join workflow_execucoes x on x.id = e.execucao_id
      where x.campanha_id is not null`)).rows
    const templates = (await c.query(`select * from templates where tipo like 'campanha\\_%'`)).rows
    // Só a assinatura do reprocessamento: resposta idêntica regravada e aviso ao
    // closer repetido. Nota legítima se repete de propósito ("Sem resposta após N
    // dias" acontece a cada ciclo), então um dedupe amplo apagaria história real.
    const duplicadas = (await c.query(`
      with alvo as (
        select * from interacoes
        where tipo = 'resposta' or descricao like 'Encaminhado ao closer%'
      )
      select a.* from alvo a
      where a.id not in (
        select (array_agg(id order by created_at))[1] from alvo group by lead_id, tipo, descricao
      )`)).rows

    // Workflows de campanha: vínculo real (campanhas.workflow_id) mais os órfãos
    // que ficaram de campanhas já apagadas. Só entram os que não seguram nenhuma
    // execução que vá permanecer.
    const idsPorVinculo = campanhas.map((x) => x.workflow_id).filter(Boolean)
    const workflows = (await c.query(`
      select w.* from workflows w
      where (w.id = any($1::uuid[]) or w.nome like 'Campanha —%')
        and not exists (
          select 1 from workflow_execucoes e
          where e.workflow_id = w.id and e.campanha_id is null
        )`, [idsPorVinculo])).rows
    const versoes = workflows.length
      ? (await c.query(`select * from workflow_versoes where workflow_id = any($1::uuid[])`,
          [workflows.map((w) => w.id)])).rows
      : []

    const porOrg = new Map<string, number>()
    for (const x of campanhas) porOrg.set(x.organizacao_id, (porOrg.get(x.organizacao_id) ?? 0) + 1)

    const real = anunciarModo({
      nome: 'APAGAR TODAS AS CAMPANHAS',
      alvo: `${porOrg.size} organização(ões) — TODAS`,
      efeitos: [
        `${campanhas.length} campanha(s)`,
        `${execucoes.length} execução(ões) de campanha + ${eventos.length} evento(s)`,
        `${workflows.length} workflow(s) gerado(s) + ${versoes.length} versão(ões)`,
        `${templates.length} template(s) gerado(s)`,
        `${duplicadas.length} interação(ões) duplicada(s) (a primeira de cada é preservada)`,
        'leads, ficha real de contato e notas de bounce NÃO são tocados',
      ],
    })

    limiteSeguranca(campanhas.length, LIMITE_CAMPANHAS, 'campanhas')

    if (!real) {
      console.log('\n  Campanhas que sairiam:')
      for (const x of campanhas) console.log(`    • ${x.nome} [${x.status}]`)
      console.log('\nENSAIO — nada apagado. Rode com --confirmar para executar.')
      return
    }

    const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(process.cwd(), 'backups', `limpeza-campanhas-${carimbo}.json`)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, JSON.stringify(
      { em: new Date().toISOString(), campanhas, execucoes, eventos, workflows, versoes, templates, duplicadas },
      null, 2), 'utf-8')
    console.log(`\n  ✔ backup: ${path.relative(process.cwd(), destino)}`)

    await c.query('begin')
    const apagar = async (rotulo: string, sql: string, params: unknown[] = []) => {
      const r = await c.query(sql, params)
      console.log(`    ${String(r.rowCount).padStart(4)} ${rotulo}`)
    }

    await apagar('evento(s) de execução', `
      delete from workflow_execucao_eventos e
      using workflow_execucoes x
      where x.id = e.execucao_id and x.campanha_id is not null`)
    await apagar('execução(ões) de campanha', `delete from workflow_execucoes where campanha_id is not null`)
    await apagar('campanha(s)', `delete from campanhas`)

    if (workflows.length) {
      const ids = workflows.map((w) => w.id)
      await apagar('vínculo(s) de versão vigente', `update workflows set versao_atual_id = null where id = any($1::uuid[])`, [ids])
      await apagar('versão(ões) de workflow', `delete from workflow_versoes where workflow_id = any($1::uuid[])`, [ids])
      await apagar('workflow(s) gerado(s)', `delete from workflows where id = any($1::uuid[])`, [ids])
    }

    await apagar('template(s) gerado(s)', `delete from templates where tipo like 'campanha\\_%'`)

    if (duplicadas.length) {
      await apagar('interação(ões) duplicada(s)', `delete from interacoes where id = any($1::uuid[])`,
        [duplicadas.map((i) => i.id)])
    }

    await c.query('commit')
    console.log('\n  ✔ transação confirmada.')

    const sobrou = await c.query(`
      select (select count(*)::int from campanhas) as campanhas,
             (select count(*)::int from workflow_execucoes where campanha_id is not null) as execucoes,
             (select count(*)::int from templates where tipo like 'campanha\\_%') as templates,
             (select count(*)::int from workflows where nome like 'Campanha —%') as workflows,
             (select count(*)::int from leads) as leads,
             (select count(*)::int from interacoes) as interacoes,
             (select count(*)::int from interacoes where descricao like 'Bounce SMTP detectado%') as notas_bounce`)
    console.log('\n  Depois:')
    console.table(sobrou.rows)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
