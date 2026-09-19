/**
 * Backfill ÚNICO de `acaoId` (Microentrega A) nas campanhas que já existiam
 * antes desta migração — sem passar por `materializarCampanhaGuiada`/
 * `ativarCampanhaGuiada` (que republicaria uma versão nova). Só escreve
 * `campanhas.publico` (JSON), nunca `workflows`/`workflow_versoes`.
 *
 * Regra (mesma de lib/campanhas/acaoId.ts, reaproveitada — não duplicada):
 *   1. Mensagem já com `acaoId` → mantém.
 *   2. Sem `acaoId`, mas existe uma versão PUBLICADA do workflow da campanha
 *      → herda o `acoes[].id` que essa versão já usa na posição correspondente
 *      (é o valor que já está em workflow_execucoes/interacoes históricos —
 *      nunca inventa um UUID novo para o que já foi enviado de verdade).
 *   3. Sem `acaoId` e sem versão publicada (rascunho nunca ativado) → UUID novo.
 *
 * ENSAIO por padrão — sem `--confirmar` só mostra o que mudaria.
 *
 * Uso:
 *   npx tsx scripts/backfill-acao-ids-legado.ts [--campanha <uuid>] [--org <uuid>]
 *   npx tsx scripts/backfill-acao-ids-legado.ts [--campanha <uuid>] --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'
import { extrairAcaoIdsPublicados, mensagensNaOrdem, resolverAcaoIds } from '../lib/campanhas/acaoId'
import type { FollowupCampanha, MensagemCampanha, Publico } from '../components/automacao/tiposCampanha'
import type { DefinicaoWorkflow } from '../lib/workflows/types'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const LIMITE_CAMPANHAS = 200

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

interface LinhaCampanha {
  id: string
  nome: string
  organizacao_id: string
  workflow_id: string | null
  publico: Publico
}

function mensagensSemAcaoId(publico: Publico): boolean {
  const msgs = mensagensNaOrdem(publico.operacao?.mensagemInicial, publico.operacao?.followups)
  return msgs.length > 0 && msgs.some((m) => !m.acaoId)
}

async function main() {
  const campanhaFiltro = arg('--campanha')
  const orgFiltro = arg('--org')

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const condicoes = ["publico->'operacao'->'mensagemInicial' is not null"]
    const params: string[] = []
    if (campanhaFiltro) { params.push(campanhaFiltro); condicoes.push(`id = $${params.length}`) }
    if (orgFiltro) { params.push(orgFiltro); condicoes.push(`organizacao_id = $${params.length}`) }
    const { rows } = await c.query<LinhaCampanha>(
      `select id, nome, organizacao_id, workflow_id, publico
         from campanhas
        where ${condicoes.join(' and ')}
        order by criado_em`,
      params,
    )

    const candidatas = rows.filter((r) => mensagensSemAcaoId(r.publico))

    console.log(`\n  campanhas com mensagemInicial: ${rows.length}`)
    console.log(`  já 100% com acaoId (nada a fazer): ${rows.length - candidatas.length}`)
    console.log(`  precisam de backfill: ${candidatas.length}`)

    interface Mudanca {
      linha: LinhaCampanha
      publicoNovo: Publico
      resumo: { assunto: string; de: string; para: string; origem: 'ja_tinha' | 'herdado_da_versao_publicada' | 'novo_uuid' }[]
    }
    const mudancas: Mudanca[] = []

    for (const linha of candidatas) {
      let idsPublicados: string[] = []
      let versaoInfo = 'sem workflow'
      if (linha.workflow_id) {
        const wf = (await c.query(
          `select status, versao_atual_id from workflows where id=$1 and organizacao_id=$2`,
          [linha.workflow_id, linha.organizacao_id],
        )).rows[0] as { status: string; versao_atual_id: string | null } | undefined
        if (wf?.versao_atual_id) {
          const versao = (await c.query(
            `select definicao from workflow_versoes where id=$1 and workflow_id=$2`,
            [wf.versao_atual_id, linha.workflow_id],
          )).rows[0] as { definicao: DefinicaoWorkflow } | undefined
          idsPublicados = extrairAcaoIdsPublicados(versao?.definicao)
          versaoInfo = `workflow ${wf.status}, ${idsPublicados.length} id(s) herdável(is) da versão vigente`
        } else {
          versaoInfo = `workflow '${wf?.status ?? 'desconhecido'}', sem versão publicada`
        }
      }

      const inicialAntes = linha.publico.operacao?.mensagemInicial
      const followupsAntes = linha.publico.operacao?.followups ?? []
      const mensagensAntes = mensagensNaOrdem(inicialAntes, followupsAntes)
      const mensagensDepois = resolverAcaoIds(mensagensAntes, idsPublicados, randomUUID)

      const resumo = mensagensAntes.map((antes, i) => ({
        assunto: antes.assunto?.slice(0, 40) || `(mensagem ${i + 1})`,
        de: antes.acaoId ?? '(nenhum)',
        para: mensagensDepois[i].acaoId!,
        origem: (antes.acaoId
          ? 'ja_tinha'
          : idsPublicados.includes(mensagensDepois[i].acaoId!)
            ? 'herdado_da_versao_publicada'
            : 'novo_uuid') as Mudanca['resumo'][number]['origem'],
      }))

      const publicoNovo: Publico = {
        ...linha.publico,
        operacao: {
          ...linha.publico.operacao,
          mensagemInicial: mensagensDepois[0] as MensagemCampanha,
          followups: mensagensDepois.slice(1).map((m, i) => ({ ...m, diasApos: followupsAntes[i]?.diasApos })) as FollowupCampanha[],
        },
      }

      mudancas.push({ linha, publicoNovo, resumo })
      console.log(`\n  • ${linha.nome} [${linha.id}] — ${versaoInfo}`)
      for (const r of resumo) {
        const marca = r.origem === 'ja_tinha' ? '=' : r.origem === 'herdado_da_versao_publicada' ? '←(histórico)' : '←(novo)'
        console.log(`      "${r.assunto}": ${r.de} ${marca} ${r.para}`)
      }
    }

    const real = anunciarModo({
      nome: 'BACKFILL acaoId — campanhas legadas',
      alvo: campanhaFiltro ? `campanha ${campanhaFiltro}` : (orgFiltro ? `org ${orgFiltro}` : 'todas as organizações'),
      efeitos: [
        `${mudancas.length} campanha(s) recebem \`acaoId\` em campanhas.publico (JSON) — só isso`,
        'NÃO toca workflows, workflow_versoes, workflow_execucoes, interacoes, mensagens_processadas',
        'NÃO republica versão, NÃO reativa campanha, NÃO envia e-mail',
      ],
    })
    limiteSeguranca(mudancas.length, LIMITE_CAMPANHAS, 'campanhas')

    if (!real) {
      console.log('\nENSAIO — nada gravado. Rode com --confirmar para persistir.')
      return
    }
    if (!mudancas.length) { console.log('\nNada a aplicar.'); return }

    const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(process.cwd(), 'backups', `backfill-acao-ids-${carimbo}.json`)
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.writeFileSync(destino, JSON.stringify({
      em: new Date().toISOString(),
      itens: mudancas.map((m) => ({ id: m.linha.id, nome: m.linha.nome, publicoAntes: m.linha.publico })),
    }, null, 2), 'utf-8')
    console.log(`\n  ✔ backup/rollback: ${path.relative(process.cwd(), destino)}`)

    await c.query('begin')
    try {
      for (const m of mudancas) {
        await c.query(`update campanhas set publico=$1, atualizado_em=now() where id=$2 and organizacao_id=$3`,
          [JSON.stringify(m.publicoNovo), m.linha.id, m.linha.organizacao_id])
      }
      await c.query('commit')
    } catch (e) {
      await c.query('rollback')
      throw e
    }
    console.log(`\n  ✔ ${mudancas.length} campanha(s) atualizada(s).`)
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error('\nERRO:', e instanceof Error ? e.message : e); process.exit(1) })
