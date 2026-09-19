/**
 * Configura, de forma atômica e escopada, a campanha de renovação da
 * organização LAUDO DE BRINQUEDOS. O padrão é SOMENTE LEITURA; gravar exige
 * `--confirmar`. Este script nunca ativa campanha, nunca remove dry_run e não
 * cria execução.
 *
 *   npx tsx scripts/configurar-renovacao-art-laudos.ts
 *   npx tsx scripts/configurar-renovacao-art-laudos.ts --confirmar
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { anunciarModo } from './_guarda'
import { montarDefinicaoCampanha } from '../lib/campanhas/configuracaoGuiada'
import { parseWorkspaceConfig, serializeWorkspaceConfig } from '../lib/config/workspaceConfig'
import {
  configurarMensagensRenovacaoArtLaudos,
} from '../lib/renovacao/emailArtLaudos'
import type { Publico } from '../components/automacao/tiposCampanha'

for (const linha of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  const indice = linha.indexOf('=')
  if (indice <= 0 || linha.startsWith('#')) continue
  const chave = linha.slice(0, indice).trim()
  if (!(chave in process.env)) process.env[chave] = linha.slice(indice + 1).trim().replace(/^["']|["']$/g, '')
}

const ORGANIZACAO = 'LAUDO DE BRINQUEDOS'
const CAMPANHA = 'Renovação automática de laudos'
const confirmar = anunciarModo({
  nome: 'Configuração da renovação — ART Laudos',
  alvo: `${ORGANIZACAO} / ${CAMPANHA}`,
  efeitos: [
    'atualiza somente os dois templates já vinculados à campanha',
    'salva o rascunho com mensagem inicial + espera de 7 dias + follow-up',
    'habilita features.ccResponsavelNaRenovacao somente nesta organização',
    'preserva status=pausada e dry_run=true; não publica nem cria execução',
  ],
})

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const org = await client.query<{ id: string; nome: string; configuracoes: unknown }>(
      `select id, nome, configuracoes from organizacoes where upper(nome) = upper($1)`,
      [ORGANIZACAO],
    )
    if (org.rowCount !== 1) throw new Error(`Organização esperada uma vez; encontradas ${org.rowCount}.`)

    const campanha = await client.query<{
      id: string
      nome: string
      status: string
      dry_run: boolean
      workflow_id: string | null
      publico: Publico | null
    }>(
      `select id, nome, status, dry_run, workflow_id, publico
         from campanhas
        where organizacao_id = $1 and tipo = 'renovacao' and nome = $2`,
      [org.rows[0].id, CAMPANHA],
    )
    if (campanha.rowCount !== 1) throw new Error(`Campanha esperada uma vez; encontradas ${campanha.rowCount}.`)
    const atual = campanha.rows[0]
    if (atual.status !== 'pausada' || atual.dry_run !== true) {
      throw new Error(`Travas divergentes: status=${atual.status}, dry_run=${atual.dry_run}. Nada será alterado.`)
    }
    if (!atual.workflow_id) throw new Error('Campanha sem workflow gerenciado. Nada será alterado.')

    const publico = configurarMensagensRenovacaoArtLaudos(atual.publico ?? {})
    const inicial = publico.operacao?.mensagemInicial
    const followup = publico.operacao?.followups?.[0]
    if (!inicial?.templateId || !inicial.templateTipo || !followup?.templateId || !followup.templateTipo) {
      throw new Error('Os dois templates vinculados à campanha não foram encontrados no público atual.')
    }
    const definicao = montarDefinicaoCampanha(publico)
    const configAtual = parseWorkspaceConfig(org.rows[0].configuracoes)
    const configNova = serializeWorkspaceConfig({
      ...configAtual,
      features: { ...configAtual.features, ccResponsavelNaRenovacao: true },
    })

    console.log(`\nOrganização: ${org.rows[0].nome} (${org.rows[0].id})`)
    console.log(`Campanha: ${atual.nome} (${atual.id})`)
    console.log(`Travas: status=${atual.status}; dry_run=${atual.dry_run}`)
    console.log(`Mensagem inicial: ${inicial.assunto}`)
    console.log(`Follow-up: dia ${followup.diasApos}; ${followup.assunto}`)
    console.log(`Ações no rascunho: ${definicao.acoes.map((acao) => acao.tipo).join(' → ')}`)

    if (!confirmar) {
      console.log('\nEnsaio concluído: nenhuma escrita realizada.')
      return
    }

    await client.query('begin')
    const templateInicialAtualizado = await client.query(
      `update templates
          set nome = $3, assunto = $4, corpo = $5, ativo = true
        where organizacao_id = $1 and id = $2 and canal = 'email'`,
      [org.rows[0].id, inicial.templateId, `${CAMPANHA} — mensagem 1`, inicial.assunto, inicial.corpo],
    )
    const templateFollowupAtualizado = await client.query(
      `update templates
          set nome = $3, assunto = $4, corpo = $5, ativo = true
        where organizacao_id = $1 and id = $2 and canal = 'email'`,
      [org.rows[0].id, followup.templateId, `${CAMPANHA} — mensagem 2`, followup.assunto, followup.corpo],
    )
    if (templateInicialAtualizado.rowCount !== 1 || templateFollowupAtualizado.rowCount !== 1) {
      throw new Error('Um dos templates deixou de pertencer à organização; a transação será revertida.')
    }
    await client.query(
      `update workflows
          set rascunho_definicao = $3, atualizado_em = now()
        where organizacao_id = $1 and id = $2`,
      [org.rows[0].id, atual.workflow_id, JSON.stringify(definicao)],
    )
    await client.query(
      `update campanhas
          set publico = $3, workflow_id = $4, atualizado_em = now()
        where organizacao_id = $1 and id = $2 and status = 'pausada' and dry_run = true`,
      [org.rows[0].id, atual.id, JSON.stringify(publico), atual.workflow_id],
    )
    await client.query(
      `update organizacoes set configuracoes = $2 where id = $1`,
      [org.rows[0].id, JSON.stringify(configNova)],
    )

    const conferencia = await client.query<{
      status: string
      dry_run: boolean
      publico: Publico
      rascunho_definicao: { acoes?: unknown[] } | null
      configuracoes: unknown
    }>(
      `select c.status, c.dry_run, c.publico, w.rascunho_definicao, o.configuracoes
         from campanhas c
         join workflows w on w.id = c.workflow_id and w.organizacao_id = c.organizacao_id
         join organizacoes o on o.id = c.organizacao_id
        where c.organizacao_id = $1 and c.id = $2`,
      [org.rows[0].id, atual.id],
    )
    const final = conferencia.rows[0]
    const followups = final.publico.operacao?.followups ?? []
    const feature = parseWorkspaceConfig(final.configuracoes).features?.ccResponsavelNaRenovacao
    if (
      final.status !== 'pausada'
      || final.dry_run !== true
      || followups.length !== 1
      || followups[0]?.diasApos !== 7
      || final.rascunho_definicao?.acoes?.length !== 3
      || feature !== true
    ) {
      throw new Error('Conferência final falhou; a transação será revertida.')
    }
    await client.query('commit')
    console.log('\nConfiguração gravada e conferida. Campanha continua pausada e em dry_run.')
  } catch (erro) {
    if (confirmar) await client.query('rollback').catch(() => undefined)
    throw erro
  } finally {
    await client.end()
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : String(erro))
  process.exit(1)
})
