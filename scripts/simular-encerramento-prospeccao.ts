// DRY-RUN — SOMENTE LEITURA. Simula, sobre os dados REAIS, o que
// encerrarProspeccaoSemResposta (lib/campanhas/prospeccaoAutomatica.ts) faria
// no primeiro tick de /api/workflows/processar após o deploy.
//
// Reproduz EXATAMENTE a mesma cadeia de SELECTs da função de produção (versão
// pós-correção: só toca em execuções do NOVO fluxo automático):
//   1) campanhas tipo='prospeccao' (todas as orgs)
//   2) workflow_execucoes status='concluido' E ciclo_chave='prospeccao_automatica'
//      (critério que exclui execuções históricas/manuais, cujo ciclo_chave é nulo)
//   3) leads com estagio em ESTAGIOS_EM_CADENCIA (=elegível a virar 'sem_resposta')
// Não executa nenhum UPDATE/INSERT/DELETE. Não importa nem chama a função de
// produção — só espelha a lógica em SQL puro para não haver risco de, por
// engano, rodar o caminho de escrita.
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const CICLO_PROSPECCAO_AUTOMATICA = 'prospeccao_automatica'

// Mesmo conjunto de lib/engine/templates.ts::ESTAGIOS_EM_CADENCIA — duplicado
// aqui de propósito (script isolado, sem importar módulos da aplicação) para
// não correr risco de puxar acidentalmente algo que toque no banco.
const ESTAGIOS_EM_CADENCIA = ['primeiro_contato', 'aguardando_resposta', 'follow_up']

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    const r = await c.query(`
      select
        l.id             as lead_id,
        o.nome           as organizacao,
        camp.id          as campanha_id,
        camp.nome        as campanha_nome,
        camp.status      as campanha_status,
        camp.dry_run     as campanha_dry_run,
        we.status        as execucao_status,
        l.estagio        as estagio_atual,
        'sem_resposta'   as estagio_resultante,
        l.empresa,
        l.contato_email
      from workflow_execucoes we
      join campanhas camp
        on camp.id = we.campanha_id
       and camp.tipo = 'prospeccao'
      join leads l
        on l.id = we.lead_id
       and l.organizacao_id = we.organizacao_id
      join organizacoes o
        on o.id = we.organizacao_id
      where we.status = 'concluido'
        and we.ciclo_chave = $2
        and l.estagio = any($1::text[])
      order by o.nome, camp.nome, l.estagio, l.id
    `, [ESTAGIOS_EM_CADENCIA, CICLO_PROSPECCAO_AUTOMATICA])

    console.log(`\n=== SIMULAÇÃO encerrarProspeccaoSemResposta (SOMENTE LEITURA) ===`)
    console.log(`Critério atual (ciclo_chave='${CICLO_PROSPECCAO_AUTOMATICA}'): ${r.rows.length} leads seriam movidos para 'sem_resposta'.\n`)
    if (r.rows.length) console.table(r.rows)

    // Contraste com o critério ANTIGO (antes da correção pedida), só para
    // deixar explícito o que deixou de ser afetado. Continua SOMENTE LEITURA.
    const antigo = await c.query(`
      select count(*)::int as total
      from workflow_execucoes we
      join campanhas camp on camp.id = we.campanha_id and camp.tipo = 'prospeccao'
      join leads l on l.id = we.lead_id and l.organizacao_id = we.organizacao_id
      where we.status = 'concluido' and l.estagio = any($1::text[])
    `, [ESTAGIOS_EM_CADENCIA])
    console.log(`Critério antigo (sem discriminar origem da execução): ${antigo.rows[0].total} leads seriam afetados.`)
    console.log(`Diferença eliminada pela correção: ${antigo.rows[0].total - r.rows.length} leads históricos/manuais preservados.\n`)

    // Agrupamento por organização + campanha, para leitura rápida.
    const porGrupo = new Map<string, { organizacao: string; campanha: string; status: string; dry_run: boolean; porEstagio: Map<string, number> }>()
    for (const row of r.rows) {
      const chave = `${row.organizacao}::${row.campanha_nome}`
      if (!porGrupo.has(chave)) {
        porGrupo.set(chave, { organizacao: row.organizacao, campanha: row.campanha_nome, status: row.campanha_status, dry_run: row.campanha_dry_run, porEstagio: new Map() })
      }
      const grupo = porGrupo.get(chave)!
      grupo.porEstagio.set(row.estagio_atual, (grupo.porEstagio.get(row.estagio_atual) ?? 0) + 1)
    }
    console.log('=== Resumo por organização/campanha ===')
    for (const g of porGrupo.values()) {
      const estagios = [...g.porEstagio.entries()].map(([e, n]) => `${e}=${n}`).join(', ')
      console.log(`- ${g.organizacao} / "${g.campanha}" (status=${g.status}, dry_run=${g.dry_run}): ${estagios}`)
    }

    // --- Segunda pergunta: risco de envio automático com PROSPECCAO_ENVIO_REAL ausente/false ---
    // A trava só gate a AUTO-CAPTURA (novos leads). O mecanismo de ENVIO em si
    // (fila + /api/workflows/processar) já existe hoje e independe dela — o
    // risco real é: existe campanha tipo='prospeccao' JÁ ativa (status='ativa',
    // dry_run=false) com execuções pendentes (em_andamento/aguardando)?
    const pendentes = await c.query(`
      select
        o.nome        as organizacao,
        camp.id       as campanha_id,
        camp.nome     as campanha_nome,
        camp.status   as campanha_status,
        camp.dry_run  as campanha_dry_run,
        we.status     as execucao_status,
        count(*)      as quantidade
      from workflow_execucoes we
      join campanhas camp
        on camp.id = we.campanha_id
       and camp.tipo = 'prospeccao'
      join organizacoes o
        on o.id = we.organizacao_id
      where camp.status = 'ativa'
        and camp.dry_run = false
        and we.status in ('em_andamento', 'aguardando')
      group by o.nome, camp.id, camp.nome, camp.status, camp.dry_run, we.status
      order by o.nome, camp.nome
    `)

    console.log(`\n=== Campanhas de prospecção JÁ REAIS (status='ativa', dry_run=false) com execuções pendentes ===`)
    console.log(`Linhas: ${pendentes.rows.length}`)
    if (pendentes.rows.length) console.table(pendentes.rows)
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
