/**
 * Reconciliação SOMENTE-LEITURA dos e-mails enviados por uma campanha cujo
 * histórico foi perdido no banco (leads apagados e reimportados → `interacoes`
 * caiu por cascade, `workflow_execucoes` foi apagada, `mensagens_processadas`
 * ficou órfã com lead_id NULL).
 *
 * O que faz:
 *   1. Lê a pasta Enviados do Gmail da conta da organização (IMAP, read-only)
 *      dentro da janela informada e filtra pelo assunto da campanha.
 *   2. Extrai destinatário (To), cópia (Cc), Date e Message-ID de cada envio.
 *   3. Casa o destinatário com os leads ATUAIS da organização por contato_email.
 *   4. Casa cada trava órfã `envio:<execucao>:<bloco>` de mensagens_processadas
 *      com o e-mail enviado logo depois dela (a trava é gravada imediatamente
 *      antes do SMTP), para saber se o lead_id pode ser reassociado com segurança.
 *   5. Imprime só agregados no terminal. Detalhes por linha (com e-mails) vão
 *      apenas para o arquivo `--saida <caminho.json>`, se informado.
 *
 * NÃO escreve nada: nem no banco, nem na caixa (mailbox aberta em readOnly).
 *
 * Uso:
 *   npx tsx scripts/reconciliar-envios-campanha.ts \
 *     --campanha 3bab5ad0-9aa5-48b0-a0f4-a2ebedb6fc33 \
 *     --de "2026-09-09T14:41:00-03:00" --ate "2026-09-10T09:47:00-03:00" \
 *     [--org <uuid>] [--assunto "LAUDO DE BRINQUEDOS"] [--conta LAUDO] \
 *     [--tolerancia-seg 90] [--saida C:/tmp/reconciliacao.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ImapFlow } from 'imapflow'

for (const l of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i <= 0 || l.startsWith('#')) continue
  const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const campanhaId = arg('--campanha') ?? ''
const de = arg('--de')
const ate = arg('--ate')
if (!campanhaId || !de || !ate) {
  console.error('Uso: --campanha <uuid> --de <ISO> --ate <ISO> [--org] [--assunto] [--conta] [--tolerancia-seg] [--saida]')
  process.exit(1)
}
const janelaDe = new Date(de)
const janelaAte = new Date(ate)
if (Number.isNaN(janelaDe.getTime()) || Number.isNaN(janelaAte.getTime()) || janelaAte <= janelaDe) {
  console.error('Janela inválida.'); process.exit(1)
}
const toleranciaMs = Number(arg('--tolerancia-seg') ?? 90) * 1_000
const saida = arg('--saida')

const normalizarEmail = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
const normalizarAssunto = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

interface Envio {
  uid: number
  messageId: string | null
  data: string            // Date header (ISO); fallback internalDate
  assunto: string
  para: string[]
  cc: string[]
}

interface LeadAtual {
  id: string
  contato_email: string | null
  empresa: string | null
  estagio: string | null
  owner: string | null
  responsavel_id: string | null
  bounced: boolean | null
  optout: boolean | null
  perdido: boolean | null
  ultimo_contato: string | null
  created_at: string
}

async function lerEnviados(user: string, pass: string, assuntoEsperado: string | null): Promise<{ mailbox: string; envios: Envio[]; foraDoAssunto: number; foraDaJanela: number }> {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user, pass }, logger: false, greetingTimeout: 15000, socketTimeout: 60000,
  })
  await client.connect()
  try {
    const caixas = await client.list()
    const enviados = caixas.find((c) => c.specialUse === '\\Sent')
      ?? caixas.find((c) => /sent|enviad/i.test(c.path))
    if (!enviados) throw new Error('Pasta Enviados não encontrada via IMAP.')

    // readOnly: garante que nada na caixa muda (nem flags \Seen).
    const lock = await client.getMailboxLock(enviados.path, { readOnly: true })
    const envios: Envio[] = []
    let foraDoAssunto = 0
    let foraDaJanela = 0
    try {
      // IMAP filtra por dia; a janela exata é aplicada abaixo pelo Date header.
      const since = new Date(janelaDe.getTime() - 24 * 3600_000)
      const before = new Date(janelaAte.getTime() + 24 * 3600_000)
      const uids = await client.search({ since, before }, { uid: true })
      if (!uids || uids.length === 0) return { mailbox: enviados.path, envios, foraDoAssunto, foraDaJanela }
      for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
        const env = m.envelope
        const data = (env?.date ?? m.internalDate) as Date | undefined
        if (!data) continue
        if (data < janelaDe || data > janelaAte) { foraDaJanela += 1; continue }
        const assunto = env?.subject ?? ''
        if (assuntoEsperado && normalizarAssunto(assunto) !== assuntoEsperado) { foraDoAssunto += 1; continue }
        envios.push({
          uid: m.uid,
          messageId: env?.messageId ?? null,
          data: data.toISOString(),
          assunto,
          para: (env?.to ?? []).map((a) => normalizarEmail(a.address)).filter(Boolean),
          cc: (env?.cc ?? []).map((a) => normalizarEmail(a.address)).filter(Boolean),
        })
      }
    } finally {
      lock.release()
    }
    envios.sort((a, b) => a.data.localeCompare(b.data) || a.uid - b.uid)
    return { mailbox: enviados.path, envios, foraDoAssunto, foraDaJanela }
  } finally {
    await client.logout()
  }
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  try {
    // ── Campanha, organização, template, workflow ────────────────────────────
    const camp = (await db.query(
      `select c.id, c.nome, c.status, c.dry_run, c.organizacao_id, c.workflow_id, c.publico,
              w.versao_atual_id, w.status as workflow_status
         from campanhas c left join workflows w on w.id = c.workflow_id
        where c.id = $1`, [campanhaId])).rows[0]
    if (!camp) throw new Error('Campanha não encontrada.')
    const org: string = arg('--org') ?? camp.organizacao_id
    if (org !== camp.organizacao_id) throw new Error('Campanha não pertence à organização informada.')

    const orgRow = (await db.query(`select nome, configuracoes->'nomenclaturas' as nomenclaturas from organizacoes where id=$1`, [org])).rows[0]
    const conta: string = arg('--conta') ?? orgRow?.nomenclaturas?.email_conta_key
    if (!conta) throw new Error('Conta de e-mail da organização não configurada (email_conta_key).')
    const user = process.env[`GMAIL_USER_${conta.toUpperCase()}`]
    const pass = process.env[`GMAIL_APP_PASSWORD_${conta.toUpperCase()}`]
    if (!user || !pass) throw new Error(`Credenciais GMAIL_USER_${conta.toUpperCase()} / GMAIL_APP_PASSWORD_${conta.toUpperCase()} ausentes no .env.local.`)

    const tipoTemplate = `campanha_${campanhaId.replace(/-/g, '')}_m1`
    const template = (await db.query(
      `select id, assunto, corpo from templates where organizacao_id=$1 and tipo=$2 order by id limit 1`, [org, tipoTemplate])).rows[0]
    const assuntoEsperado = normalizarAssunto(arg('--assunto') ?? template?.assunto ?? '')
    if (!assuntoEsperado) throw new Error('Assunto da campanha desconhecido: informe --assunto.')

    const versao = camp.versao_atual_id
      ? (await db.query(`select id, numero, definicao from workflow_versoes where id=$1`, [camp.versao_atual_id])).rows[0]
      : null
    const blocoEmail: string | null = versao?.definicao?.acoes?.find((a: { tipo: string }) => a.tipo === 'enviar_email')?.id ?? null

    // ── Estado atual do banco ───────────────────────────────────────────────
    const leads: LeadAtual[] = (await db.query(
      `select id, contato_email, empresa, estagio, owner, responsavel_id, bounced, optout, perdido, ultimo_contato, created_at
         from leads where organizacao_id=$1`, [org])).rows
    const porEmail = new Map<string, LeadAtual[]>()
    for (const l of leads) {
      const e = normalizarEmail(l.contato_email)
      if (!e) continue
      porEmail.set(e, [...(porEmail.get(e) ?? []), l])
    }

    const execucoesExistentes = Number((await db.query(
      `select count(*) from workflow_execucoes where organizacao_id=$1 and campanha_id=$2`, [org, campanhaId])).rows[0].count)
    const interacoesJanela = (await db.query(
      `select id, lead_id, tipo, canal, origem_acao, created_at from interacoes
        where organizacao_id=$1 and canal='email' and created_at >= $2 and created_at <= $3`, [org, janelaDe.toISOString(), janelaAte.toISOString()])).rows
    const travas: { id: string; mensagem_id: string; lead_id: string | null; processado_em: string }[] = (await db.query(
      `select id, mensagem_id, lead_id, processado_em from mensagens_processadas
        where organizacao_id=$1 and resultado='envio' and mensagem_id like 'envio:%'
          and processado_em >= $2 and processado_em <= $3
        order by processado_em`, [org, new Date(janelaDe.getTime() - toleranciaMs).toISOString(), janelaAte.toISOString()])).rows
    const travasComLead = travas.filter((t) => t.lead_id)
    const execIdsDasTravas = new Set(travas.map((t) => t.mensagem_id.split(':')[1]).filter(Boolean))
    const execIdsAindaExistem = execIdsDasTravas.size
      ? Number((await db.query(`select count(*) from workflow_execucoes where id = any($1::uuid[])`, [[...execIdsDasTravas]])).rows[0].count)
      : 0

    // ── Gmail: Enviados ─────────────────────────────────────────────────────
    console.log(`Lendo Enviados de ${user.replace(/^(.{3}).*(@.*)$/, '$1***$2')} (read-only)…`)
    const gmail = await lerEnviados(user, pass, assuntoEsperado)

    // ── Casamento e-mail → lead ─────────────────────────────────────────────
    type Classificacao = 'unico' | 'sem_lead' | 'multiplos' | 'sem_destinatario'
    const linhas = gmail.envios.map((envio) => {
      const destino = envio.para[0] ?? null
      const candidatos = destino ? (porEmail.get(destino) ?? []) : []
      const classe: Classificacao = !destino ? 'sem_destinatario'
        : candidatos.length === 1 ? 'unico'
        : candidatos.length === 0 ? 'sem_lead' : 'multiplos'
      return { envio, destino, candidatos, classe }
    })
    const ocorrenciasDestino = new Map<string, number>()
    for (const l of linhas) if (l.destino) ocorrenciasDestino.set(l.destino, (ocorrenciasDestino.get(l.destino) ?? 0) + 1)
    const duplicados = [...ocorrenciasDestino.entries()].filter(([, n]) => n > 1)
    const paraMultiplos = linhas.filter((l) => l.envio.para.length > 1).length
    const ccDistintos = new Map<string, number>()
    for (const l of linhas) for (const cc of l.envio.cc) ccDistintos.set(cc, (ccDistintos.get(cc) ?? 0) + 1)

    // ── Casamento trava → e-mail (por tempo) ────────────────────────────────
    // A trava é gravada imediatamente antes do SMTP: o e-mail correspondente é
    // o PRIMEIRO enviado a partir dela (o header Date tem precisão de segundos,
    // por isso a folga de 1s para trás), dentro da tolerância, e cada e-mail só
    // pode pertencer a uma trava. Travas em ordem cronológica.
    const enviosOrdenados = [...gmail.envios]
    const travaParaEnvio = new Map<string, Envio | null>()
    const usadosPorTrava = new Map<number, string>()
    let travasAmbiguas = 0
    for (const t of travas) {
      const t0 = new Date(t.processado_em).getTime()
      const candidatos = enviosOrdenados.filter((e) => {
        const d = new Date(e.data).getTime()
        return d >= t0 - 1_000 && d <= t0 + toleranciaMs && !usadosPorTrava.has(e.uid)
      })
      if (candidatos.length === 0) { travaParaEnvio.set(t.id, null); continue }
      // Dois e-mails no mesmo segundo é a única situação realmente ambígua.
      const primeiro = candidatos[0]
      const empate = candidatos.filter((e) => e.data === primeiro.data)
      if (empate.length > 1) { travaParaEnvio.set(t.id, null); travasAmbiguas += 1; continue }
      travaParaEnvio.set(t.id, primeiro); usadosPorTrava.set(primeiro.uid, t.id)
    }
    // Segurança extra: duas travas próximas (< tolerância) não podem ter sido
    // resolvidas por ordem — sinaliza para revisão.
    let travasProximas = 0
    for (let i = 1; i < travas.length; i += 1) {
      const dif = new Date(travas[i].processado_em).getTime() - new Date(travas[i - 1].processado_em).getTime()
      if (dif < toleranciaMs) travasProximas += 1
    }
    const travasResolvidas = [...travaParaEnvio.values()].filter(Boolean).length
    const enviosSemTrava = gmail.envios.filter((e) => !usadosPorTrava.has(e.uid)).length

    // ── O que precisaria ser recriado ───────────────────────────────────────
    const unicos = linhas.filter((l) => l.classe === 'unico')
    const leadsUnicos = new Set(unicos.map((l) => l.candidatos[0].id))
    const unicosComTrava = unicos.filter((l) => usadosPorTrava.has(l.envio.uid)).length
    const leadsUnicosBloqueados = unicos.filter((l) => l.candidatos[0].bounced || l.candidatos[0].optout || l.candidatos[0].perdido).length
    const leadsUnicosOwner = new Map<string, number>()
    for (const l of unicos) leadsUnicosOwner.set(l.candidatos[0].owner ?? 'null', (leadsUnicosOwner.get(l.candidatos[0].owner ?? 'null') ?? 0) + 1)
    const leadsUnicosEstagio = new Map<string, number>()
    for (const l of unicos) leadsUnicosEstagio.set(l.candidatos[0].estagio ?? 'null', (leadsUnicosEstagio.get(l.candidatos[0].estagio ?? 'null') ?? 0) + 1)
    const leadsUnicosComInteracaoNaJanela = unicos.filter((l) => interacoesJanela.some((i) => i.lead_id === l.candidatos[0].id)).length
    const leadsUnicosSemResponsavel = unicos.filter((l) => !l.candidatos[0].responsavel_id).length

    // ── Relatório (agregados; nada de PII no terminal) ──────────────────────
    const pct = (n: number, d: number) => d ? `${Math.round((n / d) * 100)}%` : '-'
    console.log('\n══════════════════════════════════════════════════════════')
    console.log(`RECONCILIAÇÃO (somente leitura) — ${camp.nome}`)
    console.log(`org: ${orgRow?.nome} (${org})`)
    console.log(`campanha: ${camp.id} status=${camp.status} dry_run=${camp.dry_run}`)
    console.log(`workflow: ${camp.workflow_id} (${camp.workflow_status}) versão vigente: ${camp.versao_atual_id ?? '-'}${versao ? ` (nº ${versao.numero})` : ''} bloco e-mail: ${blocoEmail ?? '-'}`)
    console.log(`template: ${template?.id ?? '-'} (${tipoTemplate}) assunto="${template?.assunto ?? '-'}"`)
    console.log(`janela: ${janelaDe.toISOString()} → ${janelaAte.toISOString()}  (tolerância trava→e-mail: ${toleranciaMs / 1000}s)`)
    console.log(`mailbox: ${gmail.mailbox}`)
    console.log('══════════════════════════════════════════════════════════')

    console.log('\n[1] Gmail — Enviados')
    console.log(`  e-mails da campanha na janela ........ ${gmail.envios.length}`)
    console.log(`  ignorados: outro assunto ............. ${gmail.foraDoAssunto}`)
    console.log(`  ignorados: fora da janela exata ...... ${gmail.foraDaJanela}`)
    console.log(`  com mais de um destinatário (To) ..... ${paraMultiplos}`)
    console.log(`  destinatários distintos .............. ${ocorrenciasDestino.size}`)
    console.log(`  duplicidades (mesmo destinatário >1) . ${duplicados.length} destinatário(s), ${duplicados.reduce((s, [, n]) => s + (n - 1), 0)} envio(s) extra(s)`)
    console.log(`  cópias (Cc) distintas ................ ${ccDistintos.size}${ccDistintos.size ? ` → ${[...ccDistintos.values()].join('/')} envios cada` : ''}`)
    console.log(`  sem Message-ID ....................... ${gmail.envios.filter((e) => !e.messageId).length}`)

    console.log('\n[2] Casamento destinatário → lead atual (por contato_email)')
    console.log(`  leads na org ......................... ${leads.length} (e-mails distintos: ${porEmail.size})`)
    console.log(`  match único .......................... ${unicos.length} (${pct(unicos.length, gmail.envios.length)}) → ${leadsUnicos.size} lead(s) distinto(s)`)
    console.log(`  sem correspondência .................. ${linhas.filter((l) => l.classe === 'sem_lead').length}`)
    console.log(`  múltiplas correspondências ........... ${linhas.filter((l) => l.classe === 'multiplos').length}`)
    console.log(`  sem destinatário ..................... ${linhas.filter((l) => l.classe === 'sem_destinatario').length}`)
    console.log(`  únicos: já com interação e-mail na janela  ${leadsUnicosComInteracaoNaJanela} (esperado 0)`)
    console.log(`  únicos: bounced/optout/perdido hoje .. ${leadsUnicosBloqueados}`)
    console.log(`  únicos: sem responsavel_id ........... ${leadsUnicosSemResponsavel}`)
    console.log(`  únicos por owner ..................... ${[...leadsUnicosOwner.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`)
    console.log(`  únicos por estagio ................... ${[...leadsUnicosEstagio.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`)

    console.log('\n[3] Travas órfãs em mensagens_processadas (resultado=envio)')
    console.log(`  travas na janela ..................... ${travas.length} (com lead_id: ${travasComLead.length}, órfãs: ${travas.length - travasComLead.length})`)
    console.log(`  execuções distintas nas chaves ....... ${execIdsDasTravas.size} (ainda existem: ${execIdsAindaExistem})`)
    console.log(`  execuções da campanha hoje no banco .. ${execucoesExistentes}`)
    console.log(`  trava → e-mail resolvida 1:1 ......... ${travasResolvidas} (${pct(travasResolvidas, travas.length)})`)
    console.log(`  trava ambígua (>1 e-mail na tolerância) ${travasAmbiguas}`)
    console.log(`  trava sem e-mail correspondente ...... ${travas.length - travasResolvidas - travasAmbiguas}`)
    console.log(`  travas a menos de ${toleranciaMs / 1000}s uma da outra . ${travasProximas} (0 = ordem temporal inequívoca)`)
    console.log(`  e-mails sem trava .................... ${enviosSemTrava}`)
    console.log(`  únicos (lead) que também têm trava ... ${unicosComTrava}`)

    console.log('\n[4] O que precisaria ser recriado para restaurar histórico + idempotência (por lead com match único)')
    console.log(`  interacoes ........................... ${unicos.length} linha(s): {organizacao_id, lead_id, tipo='nota', canal='email', origem_acao='ia', descricao='**<assunto>**\\n\\n<corpo>', template_id=${template?.id ?? '?'}, responsavel_id=<do lead>, created_at=<Date do e-mail>}`)
    console.log(`  leads.ultimo_contato ................. ${unicos.length} lead(s) ← Date do e-mail (só se ultimo_contato for NULL ou anterior)`)
    console.log(`  leads.owner 'n8n' → 'engine' ......... ${leadsUnicosOwner.get('n8n') ?? 0} lead(s) (estado que o enrollment deixou; detectarResposta só vincula resposta a owner='engine')`)
    console.log(`  workflow_execucoes ................... ${unicosComTrava} linha(s) com o MESMO id da trava: {id=<uuid da chave>, workflow_id, versao_id, lead_id, campanha_id, status='concluido', passo_atual=1, iniciado_em≈trava-2min, atualizado_em=<Date do e-mail>}`)
    console.log(`  workflow_execucao_eventos ............ ${unicosComTrava * 5} linha(s) (execucao_iniciada, disparo_enfileirado, email_enviado, acao_executada, concluido) por execução`)
    console.log(`  mensagens_processadas.lead_id ........ ${unicosComTrava} UPDATE (só nas travas resolvidas 1:1 cujo e-mail tem match único)`)
    console.log(`  NÃO precisa: leads.estagio (o workflow não muda estágio), leads.followups_enviados (cache só do motor legado)`)

    console.log('\n[5] Alertas')
    if (gmail.envios.length !== travas.length) console.log(`  ! e-mails (${gmail.envios.length}) ≠ travas (${travas.length})`)
    if (duplicados.length) console.log(`  ! ${duplicados.length} destinatário(s) receberam mais de um e-mail da campanha`)
    if (travasAmbiguas || travasProximas) console.log(`  ! associação trava→lead tem ${travasAmbiguas} ambíguas e ${travasProximas} travas próximas — revisar no JSON antes de usar`)
    if (execucoesExistentes) console.log(`  ! já existem ${execucoesExistentes} execuções da campanha — recriação precisa ser idempotente por id`)
    if (leadsUnicosComInteracaoNaJanela) console.log(`  ! ${leadsUnicosComInteracaoNaJanela} lead(s) já têm interação e-mail na janela — risco de duplicar`)
    if (!gmail.envios.length) console.log('  ! nenhum e-mail encontrado: confira conta, assunto e janela')
    if (!blocoEmail) console.log('  ! bloco enviar_email não encontrado na versão vigente do workflow')

    if (saida) {
      const detalhe = {
        geradoEm: new Date().toISOString(),
        campanha: { id: camp.id, nome: camp.nome, org, workflow_id: camp.workflow_id, versao_id: camp.versao_atual_id, bloco_email: blocoEmail, template_id: template?.id ?? null },
        janela: { de: janelaDe.toISOString(), ate: janelaAte.toISOString(), toleranciaSeg: toleranciaMs / 1000 },
        mailbox: gmail.mailbox,
        envios: linhas.map((l) => ({
          uid: l.envio.uid, messageId: l.envio.messageId, data: l.envio.data, para: l.envio.para, cc: l.envio.cc,
          classe: l.classe,
          leads: l.candidatos.map((c) => ({ id: c.id, empresa: c.empresa, estagio: c.estagio, owner: c.owner, responsavel_id: c.responsavel_id, bounced: c.bounced, optout: c.optout, perdido: c.perdido, ultimo_contato: c.ultimo_contato })),
          trava: usadosPorTrava.get(l.envio.uid) ?? null,
        })),
        travas: travas.map((t) => ({
          id: t.id, mensagem_id: t.mensagem_id, lead_id_atual: t.lead_id, processado_em: t.processado_em,
          execucao_id: t.mensagem_id.split(':')[1] ?? null,
          email: travaParaEnvio.get(t.id) ? { uid: travaParaEnvio.get(t.id)!.uid, data: travaParaEnvio.get(t.id)!.data, para: travaParaEnvio.get(t.id)!.para } : null,
          lead_id_proposto: (() => {
            const e = travaParaEnvio.get(t.id); if (!e) return null
            const linha = linhas.find((l) => l.envio.uid === e.uid)
            return linha?.classe === 'unico' ? linha.candidatos[0].id : null
          })(),
        })),
        duplicados: duplicados.map(([email, n]) => ({ email, envios: n })),
        semCorrespondencia: linhas.filter((l) => l.classe === 'sem_lead').map((l) => ({ para: l.destino, data: l.envio.data })),
        multiplas: linhas.filter((l) => l.classe === 'multiplos').map((l) => ({ para: l.destino, data: l.envio.data, leads: l.candidatos.map((c) => c.id) })),
      }
      fs.mkdirSync(path.dirname(saida), { recursive: true })
      fs.writeFileSync(saida, JSON.stringify(detalhe, null, 2), 'utf-8')
      console.log(`\nDetalhes (contêm e-mails — não versionar): ${saida}`)
    }
    console.log('\nNada foi escrito no banco nem na caixa de e-mail.')
  } finally {
    await db.end()
  }
}

main().catch((e) => { console.error('ERRO:', e instanceof Error ? e.message : e); process.exit(1) })
