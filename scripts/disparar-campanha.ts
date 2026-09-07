/**
 * Dispara uma campanha pelo MESMO caminho de código que o botão da tela usa
 * (`iniciarCampanhaReal` + `agendarExecucoesCampanha`), para quando o disparo
 * precisa sair de fora do navegador.
 *
 * Não reimplementa nada: publica a versão imutável, recalcula o público no
 * servidor, exige a confirmação numérica, cria as execuções e agenda o envio
 * espaçado. Se a fila da Vercel não estiver acessível daqui, processa as
 * execuções localmente com o mesmo espaçamento — o consumidor da fila faz
 * exatamente essa chamada.
 *
 * ENSAIO por padrão: sem `--confirmar` só mostra o público e para.
 *
 * `server-only` obriga a condição de resolução do React Server:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/disparar-campanha.ts <id>
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/disparar-campanha.ts <id> --confirmar
 *
 * Opções: --org <uuid>  --autor <uuid perfis.id>  --intervalo <segundos>
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG_PADRAO = '03097614-9fd5-4491-a91c-589f84461683'
const LIMITE = 200 // acima disto o disparo deixa de ser teste; revise antes

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const campanhaId = process.argv.slice(2).find((a) => !a.startsWith('--') && a.length > 20)
const org = arg('--org') ?? ORG_PADRAO
const intervaloSeg = Number(arg('--intervalo') ?? 120)

async function elegiveis(c: pg.Client, campanha: { publico: Record<string, unknown> }): Promise<
  { email: string; empresa: string }[]
> {
  const segmento = String((campanha.publico?.empresas as Record<string, unknown>)?.segmento ?? '')
  const r = await c.query<{ contato_email: string; empresa: string }>(
    `SELECT contato_email, empresa FROM leads
      WHERE organizacao_id=$1
        AND ($2 = '' OR upper(segmento) = upper($2))
        AND contato_email IS NOT NULL AND contato_email <> ''
        AND bounced IS NOT TRUE AND optout IS NOT TRUE AND perdido IS NOT TRUE
      ORDER BY empresa`,
    [org, segmento]
  )
  return r.rows.map((x) => ({ email: x.contato_email, empresa: x.empresa }))
}

async function main() {
  if (!campanhaId) {
    console.error('Informe o id da campanha: npx tsx scripts/disparar-campanha.ts <uuid> [--confirmar]')
    process.exit(1)
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  let campanha: { id: string; nome: string; status: string; dry_run: boolean; tipo: string; publico: Record<string, unknown> }
  let publico: { email: string; empresa: string }[]
  try {
    const r = await c.query(
      `SELECT id, nome, status, dry_run, tipo, publico FROM campanhas
        WHERE organizacao_id=$1 AND id=$2`,
      [org, campanhaId]
    )
    if (r.rowCount === 0) throw new Error(`Campanha ${campanhaId} não encontrada nesta organização.`)
    campanha = r.rows[0]
    publico = await elegiveis(c, campanha)
  } finally {
    await c.end()
  }

  const real = anunciarModo({
    nome: `DISPARAR CAMPANHA — ${campanha.nome}`,
    alvo: `org ${org} · campanha ${campanha.id}`,
    efeitos: [
      'publica uma versão imutável do workflow da campanha',
      'desliga o dry_run — a partir daí o envio é REAL',
      `cria as execuções e envia ${publico.length} e-mail(s), espaçados em ${intervaloSeg}s`,
    ],
  })

  console.log(`\n  status atual : ${campanha.status} · dry_run=${campanha.dry_run}`)
  console.log(`  tipo         : ${campanha.tipo}`)
  console.log(`\n  Público (${publico.length}):`)
  for (const p of publico) console.log(`    • ${p.empresa} — ${p.email}`)
  limiteSeguranca(publico.length, LIMITE, 'destinatários')

  if (!real) {
    console.log(`\nENSAIO — nada enviado. Para disparar:`)
    console.log(`  NODE_OPTIONS=--conditions=react-server npx tsx scripts/disparar-campanha.ts ${campanhaId} --confirmar\n`)
    return
  }

  const autorId = arg('--autor')
  if (!autorId) {
    console.error('\nInforme o autor da publicação: --autor <uuid de perfis.id>')
    process.exit(1)
  }

  const { createSupabaseAdminClient } = await import('@/lib/supabase-admin')
  const { iniciarCampanhaReal } = await import('@/lib/campanhas/ativacaoServidor')
  const admin = createSupabaseAdminClient()

  console.log('\n[1/2] Publicando versão e criando execuções...')
  const resultado = await iniciarCampanhaReal(admin, org, campanhaId, autorId, publico.length)
  console.log(`  ✔ inscritos=${resultado.inscritos} já_inscritos=${resultado.ja_inscritos} falhas=${resultado.falhas}`)
  const execucaoIds = resultado.execucoes_criadas ?? []
  console.log(`  ✔ execuções criadas: ${execucaoIds.length}`)

  console.log('\n[2/2] Agendando o envio espaçado...')
  const { SupabaseWorkflowStore } = await import('@/lib/workflows')
  const store = new SupabaseWorkflowStore(org, admin)
  try {
    const { agendarExecucoesCampanha } = await import('@/lib/campanhas/filaDisparoServidor')
    const fila = await agendarExecucoesCampanha(store, org, campanhaId, execucaoIds)
    console.log(`  ✔ ${Array.isArray(fila) ? fila.length : execucaoIds.length} execução(ões) na fila durável da Vercel.`)
    console.log('    O consumidor em produção envia; acompanhe pelos eventos.')
    return
  } catch (e) {
    console.log(`  ⚠ fila indisponível daqui (${e instanceof Error ? e.message : e}).`)
    console.log('    Processando localmente com o mesmo espaçamento — é a chamada que o consumidor faria.')
  }

  const { AmbienteSupabase, processarExecucoesCampanha, registrarBlocosPadrao } = await import('@/lib/workflows')
  const registro = registrarBlocosPadrao()
  const ambiente = new AmbienteSupabase(org, { client: admin })
  for (const [i, execucaoId] of execucaoIds.entries()) {
    if (i > 0) {
      console.log(`    … aguardando ${intervaloSeg}s`)
      await new Promise((r) => setTimeout(r, intervaloSeg * 1000))
    }
    try {
      await processarExecucoesCampanha(store, registro, ambiente, campanhaId, [execucaoId], new Date().toISOString(), {
        propagarErro: true,
        permitirRetryErro: true,
        ignorarAgendaCampanha: true,
      })
      console.log(`  ✔ ${i + 1}/${execucaoIds.length} processada (${execucaoId})`)
    } catch (e) {
      console.error(`  ✗ ${i + 1}/${execucaoIds.length} FALHOU: ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log('\nConcluído.')
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
