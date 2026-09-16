/**
 * Semeia os templates-base (lib/engine/templates-seed.ts) em UMA organização.
 *
 *   npx tsx scripts/seed-templates.ts --org=<uuid>              # ensaio (padrão)
 *   npx tsx scripts/seed-templates.ts --org=<uuid> --confirmar  # grava
 *
 * Só insere os templates-base que a organização ainda não tem (canal +
 * segmento + estágio). Nunca apaga, nunca sobrescreve e nunca toca outra
 * organização. Sem --org, aborta antes de conectar. Regras em lib/templates/seed.ts.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { anunciarModo } from './_guarda'
import { SEED_TEMPLATES } from '../lib/engine/templates-seed'
import { ErroSeedTemplates, executarSeedTemplates, lerOrganizacaoAlvo } from '../lib/templates/seed'

for (const linha of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
  const i = linha.indexOf('=')
  if (i > 0 && !linha.trim().startsWith('#')) {
    const k = linha.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
}

async function main() {
  let org: string
  try {
    org = lerOrganizacaoAlvo(process.argv)
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro))
    console.error('Uso: npx tsx scripts/seed-templates.ts --org=<uuid> [--confirmar]')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave || chave.includes('sua_')) {
    console.error('SUPABASE_SERVICE_ROLE_KEY real é obrigatória; não há fallback para a anon key.')
    process.exit(1)
  }

  const confirmar = anunciarModo({
    nome: 'Seed de templates-base',
    alvo: `organização ${org}`,
    efeitos: [
      'insere somente os templates-base que esta organização ainda não tem',
      'nunca apaga nem altera templates existentes',
      'não lê nem escreve templates de outras organizações',
    ],
  })

  const client = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } })
  const relatorio = await executarSeedTemplates(client, { organizacaoId: org, confirmar, seed: SEED_TEMPLATES })

  console.log(`\nOrganização: ${relatorio.organizacaoNome} (${relatorio.organizacaoId})`)
  console.log(`Templates já existentes na organização: ${relatorio.existentesNaOrganizacao}`)
  console.log(`Templates-base ausentes: ${relatorio.aInserir.length}`)
  for (const t of relatorio.aInserir) console.log(`  • ${t.canal} · ${t.nicho ?? 'genérico'} · ${t.tipo} — ${t.nome}`)
  console.log(
    relatorio.confirmado
      ? `\n${relatorio.inseridos} template(s) inserido(s).`
      : '\nEnsaio concluído: nenhuma escrita realizada. Use --confirmar para gravar.',
  )
}

main().catch((erro) => {
  console.error(erro instanceof ErroSeedTemplates ? erro.message : erro)
  process.exit(1)
})
