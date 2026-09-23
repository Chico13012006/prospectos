/**
 * Carga do catálogo de estabelecimentos da Receita Federal (migration 0050).
 *
 *   npm run catalogo:rf -- --perfis [--shards=0,1] [--mes=AAAA-MM] [--confirmar]
 *   npm run catalogo:rf -- --cnaes=5510801,5510802 [--secundarios=5510801] [...]
 *
 * Lê os dados abertos do CNPJ em streaming (Estabelecimentos, Empresas,
 * Simples, Municipios), filtra matrizes ativas dos CNAEs pedidos e grava em
 * `catalogo_estabelecimentos`. O casamento é pelo CNAE principal; pelo
 * secundário só nos CNAEs listados em --secundarios.
 *
 * --perfis monta o escopo pela união dos perfis de busca das organizações
 * (organizacoes.configuracoes.prospeccao) — só leitura, também no ensaio.
 *
 * Sem `--confirmar` é ENSAIO: baixa e conta, sem escrever no banco (só lê
 * os perfis, se --perfis). Com `--confirmar`: upsert por CNPJ e registro em
 * `catalogo_rf_cargas`. Só uma carga com os 10 shards remove linhas do escopo
 * que saíram da RF.
 *
 * Os arquivos somam alguns GB: roda por vários minutos e não cabe numa função
 * da Vercel. Não envia nada a lead nenhum.
 */
import { bootstrapEnv } from './_bootstrap'
import { anunciarModo } from './_guarda'

bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }

function argumento(nome: string): string | undefined {
  return process.argv.slice(2).find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3)
}

async function main() {
  const { carregarCatalogo, TOTAL_SHARDS } = await import('../lib/prospeccao/catalogoRf/carga')
  const { normalizarCnae } = await import('../lib/prospeccao/catalogoRf/layout')
  const { criarFonteRf, mesMaisRecenteRf } = await import('../lib/prospeccao/catalogoRf/fonteRf')

  const listaCnaes = (nome: string): string[] => {
    const brutos = (argumento(nome) ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    const normalizados = brutos.map(normalizarCnae)
    if (normalizados.some((c) => c === null)) {
      console.error(`${C.red}CNAE inválido em --${nome}: use 7 dígitos (ex.: 5510801).${C.r}`)
      process.exit(1)
    }
    return normalizados as string[]
  }

  let cnaes: string[]
  let cnaesSecundarios: string[]
  if (process.argv.includes('--perfis')) {
    const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
    const { escopoDosPerfis } = await import('../lib/prospeccao/catalogoRf/escopo')
    const { data, error } = await createSupabaseAdminClient().from('organizacoes').select('configuracoes')
    if (error) throw new Error(`Falha ao ler perfis das organizações: ${error.message}`)
    const escopo = escopoDosPerfis((data ?? []).map((o) => o.configuracoes))
    console.log(`${C.cyan}▸ Escopo de ${escopo.organizacoes} organização(ões) com perfil de busca${C.r}`)
    cnaes = escopo.cnaes
    cnaesSecundarios = escopo.cnaesSecundarios
  } else {
    cnaes = listaCnaes('cnaes')
    cnaesSecundarios = listaCnaes('secundarios')
  }
  if (cnaes.length === 0) {
    console.error(`${C.red}Nenhum CNAE: use --perfis (com perfil salvo) ou --cnaes=5510801,5510802${C.r}`)
    process.exit(1)
  }
  if (cnaesSecundarios.some((c) => !cnaes.includes(c))) {
    console.error(`${C.red}--secundarios deve ser subconjunto de --cnaes.${C.r}`)
    process.exit(1)
  }
  const shardsArg = argumento('shards')
  const shards = shardsArg
    ? shardsArg.split(',').map((s) => Number(s.trim()))
    : Array.from({ length: TOTAL_SHARDS }, (_, i) => i)

  const alvo = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : '(NEXT_PUBLIC_SUPABASE_URL ausente)'
  const real = anunciarModo({
    nome: 'Carga do catálogo RF',
    alvo,
    efeitos: [
      'upsert em catalogo_estabelecimentos (tabela global, sem organização)',
      'registro da execução em catalogo_rf_cargas',
      shards.length === TOTAL_SHARDS
        ? 'remove linhas do escopo que não apareceram neste mês da RF'
        : 'carga parcial: NÃO remove nada',
    ],
  })

  const mesRf = argumento('mes') ?? (await mesMaisRecenteRf())
  if (!/^\d{4}-\d{2}$/.test(mesRf)) throw new Error(`Mês inválido: ${mesRf}`)
  const secTxt = cnaesSecundarios.length ? ` (secundário: ${cnaesSecundarios.join(', ')})` : ''
  console.log(`${C.cyan}▸ RF ${mesRf} · CNAEs ${cnaes.join(', ')}${secTxt} · shards ${shards.join(',')}${C.r}`)

  const inicio = Date.now()
  const log = (msg: string) =>
    console.log(`${C.dim}  [${Math.round((Date.now() - inicio) / 1000)}s] ${msg}${C.r}`)

  let admin: import('@supabase/supabase-js').SupabaseClient | null = null
  let cargaId: string | null = null
  const destinoMod = real ? await import('../lib/prospeccao/catalogoRf/destinoSupabase') : null
  if (real && destinoMod) {
    const { createSupabaseAdminClient } = await import('../lib/supabase-admin')
    admin = createSupabaseAdminClient()
    cargaId = await destinoMod.registrarInicioCarga(admin, {
      mesRf, cnaes, shards, completa: shards.length === TOTAL_SHARDS,
    })
  }

  try {
    const resumo = await carregarCatalogo({
      fonte: criarFonteRf(mesRf, { aoProgredir: log }),
      mesRf,
      cnaes,
      cnaesSecundarios,
      shards,
      destino: admin && destinoMod ? destinoMod.criarDestinoSupabase(admin) : undefined,
      aoProgredir: log,
    })
    if (admin && destinoMod && cargaId) await destinoMod.registrarFimCarga(admin, cargaId, { resumo })

    const pct = (n: number) => (resumo.estabelecimentos ? `${Math.round((n / resumo.estabelecimentos) * 100)}%` : '—')
    console.log(`\n${C.b}Resultado${C.r} (${resumo.completa ? 'carga completa' : 'carga parcial'})`)
    console.log(`  linhas lidas ........ ${resumo.linhasLidas.toLocaleString('pt-BR')}`)
    console.log(`  estabelecimentos .... ${resumo.estabelecimentos.toLocaleString('pt-BR')}`)
    console.log(`  com e-mail .......... ${resumo.comEmail} (${pct(resumo.comEmail)})`)
    console.log(`  com telefone ........ ${resumo.comTelefone} (${pct(resumo.comTelefone)})`)
    console.log(`  MEI ................. ${resumo.mei}`)
    console.log(`  sem dado de empresa . ${resumo.semEmpresa}`)
    console.log(`  por CNAE principal .. ${JSON.stringify(resumo.porCnaePrincipal)}`)
    const ufs = Object.entries(resumo.porUf).sort((a, b) => b[1] - a[1]).slice(0, 10)
    console.log(`  top UFs ............. ${ufs.map(([uf, n]) => `${uf}:${n}`).join(' ')}`)
    // Amostra sem e-mail/telefone: o terminal pode ir parar em log.
    console.log(`\n${C.b}Amostra${C.r}`)
    for (const r of resumo.amostra) {
      console.log(
        `  ${r.cnpj} ${r.nome_fantasia ?? r.razao_social ?? '(sem nome)'} — ${r.municipio ?? '?'}/${r.uf ?? '?'}` +
          ` · porte ${r.porte ?? '?'} · e-mail ${r.email ? 'sim' : 'não'} · tel ${r.telefone ? 'sim' : 'não'}`
      )
    }
    console.log(
      real
        ? `\n${C.grn}✓ ${resumo.gravados} gravados, ${resumo.removidos} removidos.${C.r}`
        : `\n${C.grn}✓ Ensaio concluído — nada foi gravado.${C.r}`
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (admin && destinoMod && cargaId) await destinoMod.registrarFimCarga(admin, cargaId, { erro: msg }).catch(() => {})
    throw e
  }
}

main().catch((e) => {
  console.error(`${C.red}✗ ${e instanceof Error ? e.message : e}${C.r}`)
  process.exit(1)
})
