/**
 * Aplica (ou desfaz) a reconciliação produzida por
 * `scripts/reconciliar-envios-campanha.ts --saida <json>`: recria, para cada
 * e-mail da campanha com match ÚNICO de lead, o rastro que o motor teria
 * deixado se os leads não tivessem sido apagados e reimportados.
 *
 * Por lead (somente linhas do JSON com classe='unico' e trava casada 1:1):
 *   • workflow_execucoes         — com o MESMO id da trava `envio:<id>:<bloco>`,
 *                                  status='concluido' (o enrollment passa a ver
 *                                  `jaInscrito` e a chave de envio volta a valer)
 *   • workflow_execucao_eventos  — os 5 eventos que o executor grava
 *   • interacoes                 — nota/email/ia, como `registrarInteracao` grava
 *   • leads.ultimo_contato       — Date do e-mail (só se NULL ou anterior)
 *   • leads.owner                — 'n8n' → 'engine' (estado que o enrollment deixou)
 *   • mensagens_processadas.lead_id — reassociado à trava casada
 *
 * Os envios SEM lead (classe='sem_lead') ficam só no JSON: nada é associado.
 *
 * Idempotente: um lead cuja execução (id da trava) já existe é pulado inteiro.
 * Tudo numa transação; backup JSON em backups/ antes de gravar; o backup é a
 * entrada do `--rollback`, que desfaz exatamente o que foi criado/alterado.
 *
 * NUNCA envia e-mail: não importa provider nem toca fila/cron.
 *
 * ENSAIO por padrão — sem `--confirmar` só lista o que faria.
 *
 * Uso:
 *   npx tsx scripts/aplicar-reconciliacao-campanha.ts --relatorio <json> [--limite 5] [--confirmar]
 *   npx tsx scripts/aplicar-reconciliacao-campanha.ts --rollback backups/reconciliacao-campanha-<carimbo>.json [--confirmar]
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { anunciarModo, limiteSeguranca } from './_guarda'
import { preencher } from '@/lib/engine/mensagem'
import type { Lead } from '@/lib/engine/types'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const MOTIVO = 'reconciliacao-2026-09-13'
const LIMITE_SEGURANCA = 300

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

interface LinhaRelatorio {
  uid: number
  messageId: string | null
  data: string
  para: string[]
  classe: string
  leads: { id: string; responsavel_id: string | null; owner: string | null; ultimo_contato: string | null }[]
  trava: string | null
}
interface TravaRelatorio { id: string; mensagem_id: string; lead_id_atual: string | null; processado_em: string; execucao_id: string | null; lead_id_proposto: string | null }
interface Relatorio {
  campanha: { id: string; nome: string; org: string; workflow_id: string; versao_id: string; bloco_email: string; template_id: string }
  envios: LinhaRelatorio[]
  travas: TravaRelatorio[]
}

interface ItemBackup {
  leadId: string
  execucaoId: string
  travaId: string
  interacaoId: string
  eventoIds: number[]
  leadAntes: { owner: string | null; ultimo_contato: string | null }
  travaAntes: { lead_id: string | null }
  emailData: string
}
interface Backup {
  em: string
  motivo: string
  campanha: Relatorio['campanha']
  itens: ItemBackup[]
}

async function aplicar(relatorioPath: string, limite: number | null, real: boolean) {
  const rel = JSON.parse(fs.readFileSync(relatorioPath, 'utf-8')) as Relatorio
  const { campanha } = rel
  const travaPorId = new Map(rel.travas.map((t) => [t.id, t]))

  // Candidatos: match único de lead + trava casada 1:1 cujo lead proposto é o
  // mesmo lead. Ordem cronológica do e-mail, para o canário ser determinístico.
  const candidatos = rel.envios
    .filter((e) => e.classe === 'unico' && e.leads.length === 1 && e.trava)
    .map((e) => ({ envio: e, trava: travaPorId.get(e.trava!)! }))
    .filter(({ envio, trava }) => trava && trava.execucao_id && trava.lead_id_proposto === envio.leads[0].id)
    .sort((a, b) => a.envio.data.localeCompare(b.envio.data) || a.envio.uid - b.envio.uid)
  const selecionados = limite ? candidatos.slice(0, limite) : candidatos

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const org = campanha.org
    const camp = (await c.query(
      `select id, nome, status, dry_run, iniciada_em, atualizado_em, workflow_id from campanhas where id=$1 and organizacao_id=$2`,
      [campanha.id, org])).rows[0]
    if (!camp) throw new Error('Campanha não encontrada na organização do relatório.')
    if (camp.workflow_id !== campanha.workflow_id) throw new Error('workflow_id da campanha mudou desde o relatório.')
    const versao = (await c.query(`select id, definicao from workflow_versoes where id=$1 and workflow_id=$2 and organizacao_id=$3`,
      [campanha.versao_id, campanha.workflow_id, org])).rows[0]
    if (!versao) throw new Error('Versão do workflow do relatório não existe mais.')
    const tpl = (await c.query(`select id, tipo, assunto, corpo from templates where id=$1 and organizacao_id=$2`, [campanha.template_id, org])).rows[0]
    if (!tpl) throw new Error('Template do relatório não existe mais.')
    const nomenclaturas = (await c.query(`select configuracoes->'nomenclaturas' n from organizacoes where id=$1`, [org])).rows[0]?.n ?? {}
    const orgNome = (await c.query(`select nome from organizacoes where id=$1`, [org])).rows[0]?.nome ?? ''
    const nomeServico: string = nomenclaturas?.nome_servico ?? orgNome
    const extras: Record<string, string> = nomeServico ? { nome_servico: nomeServico } : {}

    // Estado atual dos alvos (idempotência + backup).
    const ids = selecionados.map((s) => s.envio.leads[0].id)
    const execIds = selecionados.map((s) => s.trava.execucao_id!)
    const leadsAtuais = new Map<string, Lead & { owner: string | null; ultimo_contato: string | null }>()
    for (let i = 0; i < ids.length; i += 200) {
      const r = await c.query(`select l.*, u.nome as usuario_nome from leads l left join usuarios u on u.id = l.responsavel_id where l.organizacao_id=$1 and l.id = any($2::uuid[])`, [org, ids.slice(i, i + 200)])
      for (const row of r.rows) {
        // `pg` (driver cru) devolve colunas `date` como objeto Date; o resto do
        // app (Supabase JS) as lê como string 'YYYY-MM-DD'. `preencher()` (via
        // formatarDataIsoSemFuso) espera essa string — sem isso, {data_validade}
        // quebra com "valor?.slice is not a function" no meio da transação.
        const dataValidade = row.data_validade instanceof Date
          ? row.data_validade.toISOString().slice(0, 10)
          : row.data_validade
        leadsAtuais.set(row.id, { ...row, data_validade: dataValidade, usuarios: row.usuario_nome ? { nome: row.usuario_nome } : undefined })
      }
    }
    const execExistentes = new Set<string>(execIds.length
      ? (await c.query(`select id from workflow_execucoes where id = any($1::uuid[])`, [execIds])).rows.map((r) => r.id)
      : [])
    const travasAtuais = new Map<string, { lead_id: string | null }>(
      (await c.query(`select id, lead_id from mensagens_processadas where organizacao_id=$1 and id = any($2::uuid[])`,
        [org, selecionados.map((s) => s.trava.id)])).rows.map((r) => [r.id, { lead_id: r.lead_id }]))

    const aplicaveis = selecionados.filter((s) => {
      const lead = leadsAtuais.get(s.envio.leads[0].id)
      return lead && !execExistentes.has(s.trava.execucao_id!) && travasAtuais.has(s.trava.id)
    })
    const jaAplicados = selecionados.filter((s) => execExistentes.has(s.trava.execucao_id!)).length
    const semLeadAgora = selecionados.filter((s) => !leadsAtuais.has(s.envio.leads[0].id)).length

    console.log(`\n  campanha      : ${camp.nome} (${camp.status}, dry_run=${camp.dry_run})`)
    console.log(`  candidatos    : ${candidatos.length} (match único + trava 1:1)`)
    console.log(`  selecionados  : ${selecionados.length}${limite ? ` (limite ${limite}, ordem cronológica)` : ''}`)
    console.log(`  já aplicados  : ${jaAplicados} (execução já existe — pulados)`)
    console.log(`  lead sumiu    : ${semLeadAgora}`)
    console.log(`  a aplicar     : ${aplicaveis.length}`)
    console.log(`  por lead      : 1 execução + 5 eventos + 1 interação + leads.{ultimo_contato,owner} + mensagens_processadas.lead_id`)
    for (const s of aplicaveis.slice(0, 10)) {
      const lead = leadsAtuais.get(s.envio.leads[0].id)!
      console.log(`    • lead ${lead.id} (${(lead.empresa ?? '').slice(0, 30)}) ← e-mail ${s.envio.data} exec ${s.trava.execucao_id}`)
    }
    if (aplicaveis.length > 10) console.log(`    … +${aplicaveis.length - 10}`)
    limiteSeguranca(aplicaveis.length, LIMITE_SEGURANCA, 'leads')

    if (!real) {
      console.log('\nENSAIO — nada gravado. Rode com --confirmar para aplicar.')
      return
    }
    if (!aplicaveis.length) { console.log('\nNada a aplicar.'); return }

    const carimbo = new Date().toISOString().replace(/[:.]/g, '-')
    const destino = path.join(process.cwd(), 'backups', `reconciliacao-campanha-${carimbo}.json`)
    const backup: Backup = { em: new Date().toISOString(), motivo: MOTIVO, campanha, itens: [] }

    const assunto = preencher(tpl.assunto ?? '{empresa}', leadsAtuais.get(aplicaveis[0].envio.leads[0].id)!, extras)
    await c.query('begin')
    try {
      for (const s of aplicaveis) {
        const lead = leadsAtuais.get(s.envio.leads[0].id)!
        const execucaoId = s.trava.execucao_id!
        const emailData = s.envio.data
        const iniciadoEm = camp.iniciada_em ?? emailData
        const enfileiradoEm = camp.atualizado_em ?? iniciadoEm
        const assuntoLead = preencher(tpl.assunto ?? '{empresa}', lead, extras)
        const corpoLead = preencher(tpl.corpo, lead, extras)

        // 1) execução (mesmo id da trava → a chave envio:<id>:<bloco> volta a valer)
        const ex = await c.query(
          `insert into workflow_execucoes (id, organizacao_id, workflow_id, versao_id, lead_id, passo_atual, status, proxima_verificacao_em, iniciado_em, atualizado_em, campanha_id)
           values ($1,$2,$3,$4,$5,1,'concluido',$6,$7,$8,$9) on conflict (id) do nothing returning id`,
          [execucaoId, org, campanha.workflow_id, campanha.versao_id, lead.id, s.trava.processado_em, iniciadoEm, emailData, campanha.id])
        if (ex.rowCount !== 1) throw new Error(`Execução ${execucaoId} já existia dentro da transação.`)

        // 2) eventos, na ordem e com o detalhe que o executor grava
        const eventos: [string, unknown, string][] = [
          ['execucao_iniciada', { via: 'campanha', lead_id: lead.id, versao_id: campanha.versao_id, servico_id: null, ciclo_chave: null }, iniciadoEm],
          ['disparo_enfileirado', { campanha_id: campanha.id, agendado_para: s.trava.processado_em, intervalo_segundos: 120 }, enfileiradoEm],
          ['email_enviado', { assunto: assuntoLead, enviado: true, template: tpl.tipo }, emailData],
          ['acao_executada', { acao: 'enviar_email', passo: 0 }, emailData],
          ['concluido', null, emailData],
        ]
        const eventoIds: number[] = []
        for (const [tipo, detalhe, criadoEm] of eventos) {
          const ev = await c.query(
            `insert into workflow_execucao_eventos (organizacao_id, execucao_id, tipo, detalhe, criado_em) values ($1,$2,$3,$4,$5) returning id`,
            [org, execucaoId, tipo, detalhe === null ? null : JSON.stringify(detalhe), criadoEm])
          eventoIds.push(Number(ev.rows[0].id))
        }

        // 3) interação exatamente como registrarInteracao grava (+ motivo p/ rollback)
        const interacaoId = randomUUID()
        await c.query(
          `insert into interacoes (id, organizacao_id, lead_id, tipo, canal, descricao, origem_acao, responsavel_id, template_id, motivo, created_at)
           values ($1,$2,$3,'nota','email',$4,'ia',$5,$6,$7,$8)`,
          [interacaoId, org, lead.id, `**${assuntoLead}**\n\n${corpoLead}`, lead.responsavel_id ?? null, tpl.id, MOTIVO, emailData])

        // 4) lead: ultimo_contato (só avança) + owner engine
        await c.query(
          `update leads set
             ultimo_contato = case when ultimo_contato is null or ultimo_contato < $3::timestamptz then $3::timestamptz else ultimo_contato end,
             owner = case when owner = 'n8n' then 'engine' else owner end
           where id=$1 and organizacao_id=$2`,
          [lead.id, org, emailData])

        // 5) trava órfã reassociada
        await c.query(`update mensagens_processadas set lead_id=$3 where id=$1 and organizacao_id=$2 and lead_id is null`, [s.trava.id, org, lead.id])

        backup.itens.push({
          leadId: lead.id, execucaoId, travaId: s.trava.id, interacaoId, eventoIds,
          leadAntes: { owner: lead.owner, ultimo_contato: lead.ultimo_contato ? new Date(lead.ultimo_contato).toISOString() : null },
          travaAntes: { lead_id: travasAtuais.get(s.trava.id)?.lead_id ?? null },
          emailData,
        })
      }
      fs.mkdirSync(path.dirname(destino), { recursive: true })
      fs.writeFileSync(destino, JSON.stringify(backup, null, 2), 'utf-8')
      await c.query('commit')
    } catch (e) {
      await c.query('rollback')
      throw e
    }
    console.log(`\n  ✔ ${backup.itens.length} lead(s) reconciliado(s). Assunto: "${assunto}"`)
    console.log(`  ✔ backup/rollback: ${path.relative(process.cwd(), destino)}`)
  } finally {
    await c.end()
  }
}

async function rollback(backupPath: string, real: boolean) {
  const bk = JSON.parse(fs.readFileSync(backupPath, 'utf-8')) as Backup
  const org = bk.campanha.org
  console.log(`\n  backup de ${bk.em} — ${bk.itens.length} item(ns), motivo ${bk.motivo}`)
  if (!real) { console.log('\nENSAIO — nada desfeito. Rode com --confirmar.'); return }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query('begin')
    let n = 0
    for (const it of bk.itens) {
      await c.query(`delete from interacoes where id=$1 and organizacao_id=$2 and motivo=$3`, [it.interacaoId, org, bk.motivo])
      await c.query(`delete from workflow_execucao_eventos where organizacao_id=$1 and execucao_id=$2 and id = any($3::bigint[])`, [org, it.execucaoId, it.eventoIds])
      await c.query(`delete from workflow_execucoes where id=$1 and organizacao_id=$2 and campanha_id=$3`, [it.execucaoId, org, bk.campanha.id])
      await c.query(`update leads set owner=$3, ultimo_contato=$4 where id=$1 and organizacao_id=$2`, [it.leadId, org, it.leadAntes.owner, it.leadAntes.ultimo_contato])
      await c.query(`update mensagens_processadas set lead_id=$3 where id=$1 and organizacao_id=$2`, [it.travaId, org, it.travaAntes.lead_id])
      n += 1
    }
    await c.query('commit')
    console.log(`\n  ✔ ${n} item(ns) desfeito(s).`)
  } catch (e) {
    await c.query('rollback'); throw e
  } finally {
    await c.end()
  }
}

async function main() {
  const rollbackPath = arg('--rollback')
  const relatorio = arg('--relatorio')
  const limite = arg('--limite') ? Number(arg('--limite')) : null
  if (!rollbackPath && !relatorio) {
    console.error('Uso: --relatorio <json> [--limite N] [--confirmar]  |  --rollback <backup.json> [--confirmar]')
    process.exit(1)
  }
  const real = anunciarModo({
    nome: rollbackPath ? 'DESFAZER RECONCILIAÇÃO DE CAMPANHA' : 'APLICAR RECONCILIAÇÃO DE CAMPANHA',
    alvo: rollbackPath ? path.basename(rollbackPath) : `${path.basename(relatorio!)}${limite ? ` · limite ${limite}` : ''}`,
    efeitos: rollbackPath
      ? ['apaga interações/execuções/eventos criados pela reconciliação', 'restaura leads.owner e ultimo_contato', 'devolve lead_id NULL às travas']
      : ['insere workflow_execucoes (concluído) + eventos', 'insere interacoes nota/email/ia', 'atualiza leads.ultimo_contato e owner', 'reassocia mensagens_processadas.lead_id', 'NÃO envia e-mail, NÃO toca fila/cron/campanha'],
  })
  if (rollbackPath) await rollback(rollbackPath, real)
  else await aplicar(relatorio!, limite, real)
}

main().catch((e) => { console.error('\nERRO:', e instanceof Error ? e.message : e); process.exit(1) })
