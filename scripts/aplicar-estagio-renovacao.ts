/**
 * Reclassifica como `renovacao` os leads de UMA organização que têm
 * data_validade e ainda estão em estágio de entrada (novos_leads, novo,
 * primeiro_contato). Estágios comerciais posteriores e leads sem validade não
 * são tocados. Regra e travas: lib/leads/aplicarEstagioRenovacao.ts.
 *
 *   Simulação (padrão — transação somente leitura, nada é gravado):
 *     npx tsx scripts/aplicar-estagio-renovacao.ts --org <uuid>
 *
 *   Gravação (exige a quantidade vista na simulação; gera backup em backups/):
 *     npx tsx scripts/aplicar-estagio-renovacao.ts --org <uuid> --confirmar --esperado <n>
 *
 *   Reversão pelo backup (simulação sem --confirmar):
 *     npx tsx scripts/aplicar-estagio-renovacao.ts --org <uuid> --reverter backups/<arquivo>.json [--confirmar]
 *
 * NÃO liga a flag features.estagioRenovacaoPorValidade (scripts/set-workspace-feature.ts).
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import {
  aplicarEstagioRenovacao,
  montarBackupEstagioRenovacao,
  reverterEstagioRenovacao,
  type BackupEstagioRenovacao,
  type ClienteSql,
  type RelatorioEstagioRenovacao,
} from '../lib/leads/aplicarEstagioRenovacao'
import { ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO } from '../lib/leads/estagioInicial'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const org = arg('--org') ?? ''
const confirmar = process.argv.includes('--confirmar')
const esperadoRaw = arg('--esperado')
const reverter = arg('--reverter')

function imprimirPlano(r: RelatorioEstagioRenovacao) {
  console.log(`\nOrganização: ${r.org.nome ?? '(sem nome)'} (${r.org.id})`)
  console.log(`Flag features.estagioRenovacaoPorValidade: ${r.org.regraAtiva ? 'ligada' : 'desligada'} (este script não altera a flag)`)
  console.log(`\nLeads da organização: ${r.totais.total}`)
  console.log(`  com validade: ${r.totais.comValidade}`)
  console.log(`  sem validade: ${r.totais.semValidade} (fora do filtro — não são tocados)`)
  console.log('\nDistribuição por estágio dos leads COM validade:')
  console.table(r.distribuicaoComValidade)
  console.log(`\nFiltro: organizacao_id = ${r.org.id} AND data_validade IS NOT NULL AND estagio IN (${ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO.join(', ')})`)
  console.log(`Leads que passam para 'renovacao': ${r.candidatos.length}`)
  console.table(r.candidatos.map((c) => ({
    id: c.id,
    empresa: c.empresa,
    estagio_anterior: c.estagio,
    owner: c.owner,
    validade: c.data_validade,
  })))
  console.log(`Com validade, mas em estágio comercial posterior (preservados): ${r.comValidadeForaDoFiltro}`)
  console.log(`Leads de outras organizações (fora do filtro — não são tocados): ${r.leadsOutrasOrganizacoes}`)
}

async function main() {
  if (!org) {
    console.error('uso: aplicar-estagio-renovacao.ts --org <uuid> [--confirmar --esperado <n>] | --org <uuid> --reverter <backup.json> [--confirmar]')
    process.exit(2)
  }
  const esperado = esperadoRaw === undefined ? undefined : Number(esperadoRaw)
  if (esperadoRaw !== undefined && !Number.isInteger(esperado)) {
    console.error('--esperado precisa ser um número inteiro.')
    process.exit(2)
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const db: ClienteSql = { query: (sql, params) => client.query(sql, params) }
  try {
    if (reverter) {
      const backup = JSON.parse(fs.readFileSync(path.resolve(reverter), 'utf-8')) as BackupEstagioRenovacao
      const r = await reverterEstagioRenovacao(db, { org, backup, confirmar })
      console.log(`\nNo backup: ${r.noBackup} | ainda em 'renovacao' (revertíveis): ${r.revertiveis.length} | movidos depois (preservados): ${r.preservados.length}`)
      if (r.preservados.length) console.table(r.preservados)
      console.log(r.modo === 'simulacao'
        ? '\nSIMULAÇÃO — nada foi gravado. Repita com --confirmar para reverter.'
        : `\nREVERTIDO: ${r.revertidos} lead(s) voltaram ao estágio anterior.`)
      return
    }

    const r = await aplicarEstagioRenovacao(db, {
      org,
      confirmar,
      esperado,
      antesDeGravar: (plano) => {
        imprimirPlano(plano)
        const dir = path.join(process.cwd(), 'backups')
        fs.mkdirSync(dir, { recursive: true })
        const arquivo = path.join(dir, `estagio-renovacao-${org}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
        fs.writeFileSync(arquivo, JSON.stringify(montarBackupEstagioRenovacao(plano), null, 2))
        console.log(`\nBackup para reversão: ${path.relative(process.cwd(), arquivo)}`)
      },
    })

    if (r.modo === 'simulacao') {
      imprimirPlano(r)
      console.log('\nSIMULAÇÃO — nada foi gravado (transação somente leitura encerrada com ROLLBACK).')
      console.log(`Para gravar: npx tsx scripts/aplicar-estagio-renovacao.ts --org ${org} --confirmar --esperado ${r.candidatos.length}`)
    } else {
      console.log(`\nGRAVADO: ${r.gravacao?.alterados} lead(s) → 'renovacao'.`)
      console.log('Conferências antes do COMMIT: ok — leads sem validade, demais leads da organização e outras organizações intactos; nos alterados só estagio/updated_at mudaram.')
      console.log(`Total em 'renovacao' na organização agora: ${r.gravacao?.renovacaoNaOrganizacao}`)
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
