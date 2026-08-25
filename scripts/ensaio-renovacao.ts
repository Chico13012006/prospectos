/**
 * Relatório de ENSAIO da renovação (dryRun): NÃO escreve nada, NÃO envia nada.
 * Mostra o que o cron faria hoje para uma organização.
 *   npx tsx scripts/ensaio-renovacao.ts [organizacao_id]
 * Default: organização de Laudos.
 */
process.env.MODO_ENSAIO = 'true'
delete process.env.RENOVACAO_ENVIO_REAL
import fs from 'node:fs'
import path from 'node:path'
import { processarRenovacoes } from '../lib/renovacao/processar'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG = process.argv[2] ?? '03097614-9fd5-4491-a91c-589f84461683'

async function main() {
  const r = await processarRenovacoes(ORG, { dryRun: true })
  console.log(`\n=== ENSAIO DE RENOVAÇÃO (org ${ORG}) — dryRun, nada escrito/enviado ===`)
  console.table([{
    validades_avaliadas: r.avaliados,
    dentro_da_janela: r.naJanela,
    tarefas_que_seriam_criadas: r.tarefas,
    notificacoes_que_seriam_geradas: r.notificacoes,
    mensagens_que_seriam_enviadas: r.mensagens,
    duplicacoes_evitadas: r.duplicacoesEvitadas,
  }])
  if (r.itens.length) {
    console.log('Itens na janela:')
    console.table(r.itens.map((i) => ({
      fonte: i.fonte, empresa: i.empresa, vencimento: i.vencimento, dias: i.dias,
      ja_tem_tarefa: i.jaTemTarefa, dest_tarefa: i.destinatarioTarefa, dest_mensagem: i.destinatarioMensagem,
    })))
  } else {
    console.log('Nenhuma validade na janela (cadastre um serviço recorrente ou a validade legada no lead).')
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
