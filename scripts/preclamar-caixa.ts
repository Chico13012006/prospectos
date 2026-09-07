/**
 * Pré-marca como PROCESSADAS todas as mensagens que já estão na caixa.
 *
 * Por que existe: a idempotência da migration 0030 só vale a partir da primeira
 * vez que uma mensagem é vista. Sem este passo, a primeira passada depois do
 * deploy trataria os 30 dias de histórico como novidade — cancelando envios em
 * andamento e avisando o closer de conversas velhas, exatamente o incidente de
 * 05–07/09/2026.
 *
 * Não perde nada: toda mensagem hoje na caixa já foi processada (muitas vezes)
 * pelo código que está rodando. Este script apenas registra esse fato.
 *
 * SOMENTE LEITURA no e-mail: lê a caixa, não envia, não marca como lida, não
 * altera lead nem execução. A única escrita é em `mensagens_processadas`.
 *
 * Uso:
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/preclamar-caixa.ts [--org <uuid>]
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/preclamar-caixa.ts --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'
import { anunciarModo } from './_guarda'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const ORG_PADRAO = '03097614-9fd5-4491-a91c-589f84461683'

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const org = arg('--org') ?? ORG_PADRAO

  const real = anunciarModo({
    nome: 'PRÉ-MARCAR A CAIXA COMO PROCESSADA',
    alvo: `org ${org}`,
    efeitos: [
      'lê a caixa de entrada (sem enviar, sem marcar como lida)',
      'registra cada mensagem em mensagens_processadas',
      'a primeira passada do monitor depois disto começa limpa',
    ],
  })

  const { createSupabaseAdminClient } = await import('@/lib/supabase-admin')
  const { SupabaseStore } = await import('@/lib/engine/store/supabaseStore')
  const { GmailProvider, lerCredenciaisGmail } = await import('@/lib/engine/email/gmailProvider')
  const { parseWorkspaceConfig } = await import('@/lib/config/workspaceConfig')

  const admin = createSupabaseAdminClient()
  const { data: orgRow } = await admin
    .from('organizacoes').select('nome, configuracoes').eq('id', org).maybeSingle()
  if (!orgRow) throw new Error(`Organização ${org} não encontrada.`)
  const cfg = parseWorkspaceConfig((orgRow as { configuracoes?: unknown }).configuracoes)
  const conta = cfg.nomenclaturas?.email_conta_key?.trim() || 'followup'
  const cred = lerCredenciaisGmail(conta)
  if (!cred) throw new Error(`Sem credencial Gmail para a conta '${conta}'.`)

  console.log(`\n  organização : ${(orgRow as { nome: string }).nome}`)
  console.log(`  caixa       : ${cred.user}`)

  const provider = new GmailProvider(cred)
  const mensagens = await provider.lerCaixaEntrada()
  console.log(`  mensagens na janela: ${mensagens.length}`)

  const store = new SupabaseStore(org, admin)
  let novas = 0
  let jaMarcadas = 0
  for (const msg of mensagens) {
    const chave = msg.mensagemId ?? msg.idRecebimento ?? ''
    if (!chave) continue
    if (!real) continue
    const primeira = await store.reivindicarMensagem(chave, 'pre-marcada')
    if (primeira) novas++
    else jaMarcadas++
  }

  if (!real) {
    console.log('\nENSAIO — nada gravado. Rode com --confirmar para pré-marcar.')
    return
  }
  console.log(`\n  ✔ ${novas} mensagem(ns) pré-marcada(s); ${jaMarcadas} já estavam registradas.`)
  console.log('  A partir de agora, só mensagem NOVA gera ação.')
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
