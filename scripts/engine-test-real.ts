/**
 * Teste manual do Fluxo 1 (Executar Ação) contra o Supabase REAL, em ensaio.
 *
 *   npm run engine:test-real <lead_id>
 *
 * - Conecta no Supabase com as credenciais do .env.local (SupabaseStore real).
 * - Carrega o lead, roda executarAcao e imprime destinatário, assunto/corpo e
 *   próximo estágio.
 * - Respeita o MODO_ENSAIO do .env.local:
 *     true  → provedor simulado (não envia) + wrapper dry-run (não escreve no banco).
 *     false → GmailProvider SMTP (envia de verdade) + SupabaseStore real (escreve).
 * - Respeita a trava owner: se owner != 'engine', recusa e não faz nada.
 */
import fs from 'node:fs'
import path from 'node:path'

// 1) Carregar .env.local ANTES de importar o motor (config lê env na importação).
function carregarEnvLocal() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) throw new Error('.env.local não encontrado em ' + p)
  for (const linha of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const i = linha.indexOf('=')
    if (i <= 0) continue
    const k = linha.slice(0, i).trim()
    const v = linha.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!(k in process.env)) process.env[k] = v
  }
}
carregarEnvLocal() // respeita o MODO_ENSAIO do .env.local (não força nada)

const leadId = process.argv[2]
if (!leadId) {
  console.error('Uso: npm run engine:test-real <lead_id>')
  process.exit(1)
}

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const linha = () => console.log(C.dim + '─'.repeat(70) + C.r)

async function main() {
  // 2) Importações dinâmicas (depois do env já estar setado).
  const { createClient } = await import('@supabase/supabase-js')
  const { SupabaseStore } = await import('../lib/engine/store/supabaseStore')
  const { SimulatedProvider } = await import('../lib/engine/email/simulatedProvider')
  const { GmailProvider, lerCredenciaisGmail } = await import('../lib/engine/email/gmailProvider')
  const { executarAcao } = await import('../lib/engine/flows/executarAcao')
  const { montarMensagem, proximoEstagio, tipoDoEnvio } = await import('../lib/engine/templates')
  const { engineConfig } = await import('../lib/engine/config')
  type Store = import('../lib/engine/store/store').Store
  type EmailProvider = import('../lib/engine/email/provider').EmailProvider
  type Lead = import('../lib/engine/types').Lead

  const ensaio = engineConfig.modoEnsaio

  // 3) Client real. Usa a service role se estiver configurada de verdade;
  //    caso contrário cai para a anon key (mesma lógica do importar-hubspot.js).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  const usandoService = !!(sk && !sk.includes('sua_'))
  const key = usandoService ? sk! : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const real: Store = new SupabaseStore(client)

  // 4) Wrapper DRY-RUN: leituras passam adiante (Supabase real); escritas só logam.
  const escritas: string[] = []
  const dryStore: Store = {
    buscarLead: (id) => real.buscarLead(id),
    buscarLeadPorEmail: (e) => real.buscarLeadPorEmail(e),
    buscarLeadPorDominio: (d) => real.buscarLeadPorDominio(d),
    contarInteracoes: (id, t) => real.contarInteracoes(id, t),
    enviosHoje: () => real.enviosHoje(),
    leadsParaFollowup: () => real.leadsParaFollowup(),
    leadsEsgotadosSemResposta: () => real.leadsEsgotadosSemResposta(),
    buscarUsuario: (id) => real.buscarUsuario(id),
    async atualizarLead(id, patch) {
      escritas.push('UPDATE leads ' + JSON.stringify(patch) + ' WHERE id=' + id)
      console.log(`${C.yel}  [DRY-RUN] NÃO escrito → atualizarLead:${C.r} ${JSON.stringify(patch)}`)
    },
    async registrarInteracao(i) {
      escritas.push('INSERT interacoes tipo=' + i.tipo)
      console.log(
        `${C.yel}  [DRY-RUN] NÃO escrito → registrarInteracao:${C.r} tipo=${i.tipo} canal=${i.canal}`,
      )
    },
  }

  // Em ENSAIO: store dry-run (não escreve) + provedor simulado (não envia).
  // Em REAL: store real (escreve) + GmailProvider SMTP (envia de verdade).
  let store: Store
  let email: EmailProvider
  if (ensaio) {
    store = dryStore
    email = new SimulatedProvider()
  } else {
    store = real
    const cred = lerCredenciaisGmail()
    if (!cred) {
      console.log(`${C.red}✗ MODO_ENSAIO=false mas faltam GMAIL_USER / GMAIL_APP_PASSWORD no .env.local.${C.r}`)
      process.exit(1)
    }
    email = new GmailProvider(cred)
  }

  console.log(`\n${C.b}🧪 TESTE — Fluxo 1: Executar Ação${C.r}`)
  console.log(
    `${C.dim}Supabase: ${url}  | chave: ${usandoService ? 'service_role' : 'anon'} | ` +
      `MODO_ENSAIO=${ensaio}${C.r}`,
  )
  console.log(
    ensaio
      ? `${C.yel}Modo ENSAIO: nada será enviado nem escrito (dry-run).${C.r}`
      : `${C.red}${C.b}Modo REAL: o e-mail SERÁ enviado e o banco SERÁ atualizado.${C.r}`,
  )
  linha()

  const lead = (await store.buscarLead(leadId)) as Lead | null
  if (!lead) {
    console.log(`${C.red}✗ Lead ${leadId} não encontrado no Supabase.${C.r}`)
    process.exit(1)
  }

  console.log(`${C.b}Lead carregado:${C.r}`)
  console.log(`  empresa        : ${lead.empresa}`)
  console.log(`  contato        : ${lead.contato_nome ?? '-'} <${lead.contato_email}>`)
  console.log(`  estágio atual  : ${lead.estagio}`)
  console.log(`  owner          : ${C.b}${lead.owner ?? '(sem coluna)'}${C.r}`)
  console.log(`  segmento       : ${lead.segmento ?? '-'}  | score: ${lead.score}`)
  console.log(`  perdido        : ${lead.perdido}`)
  linha()

  // 5) Prévia do que o motor montaria (independente do resultado).
  const tipo = tipoDoEnvio(lead.estagio)
  const destino = proximoEstagio(lead.estagio)
  const msg = montarMensagem(lead, destino)
  console.log(`${C.b}O que o motor FARIA (prévia):${C.r}`)
  console.log(`  tipo de envio  : ${tipo}`)
  console.log(`  transição      : ${lead.estagio} ${C.cyan}→${C.r} ${destino}`)
  console.log(`  destinatário   : ${msg && lead.contato_email}`)
  console.log(`  assunto        : ${msg.assunto}`)
  console.log(`${C.dim}  ─ corpo ─${C.r}`)
  console.log(msg.corpo.split('\n').map((l) => '  ' + l).join('\n'))
  linha()

  // 6) Executa de fato o fluxo.
  console.log(`${C.b}Execução de executarAcao() (${ensaio ? 'ensaio' : 'REAL'}):${C.r}`)
  const r = await executarAcao(store, email, { leadId })
  linha()

  const enviou = r.ok ? 1 : 0
  console.log(`${C.b}Resultado:${C.r} ${JSON.stringify(r)}`)
  if (ensaio) {
    console.log(`  e-mails que TERIAM sido enviados: ${(email as InstanceType<typeof SimulatedProvider>).enviados.length}`)
    console.log(`  escritas no banco que TERIAM ocorrido: ${escritas.length}`)
    if (escritas.length) escritas.forEach((e) => console.log(`    ${C.dim}• ${e}${C.r}`))
  } else {
    console.log(`  e-mails ENVIADOS de verdade: ${enviou}`)
    console.log(`  escritas no banco realizadas: ${enviou ? 2 : 0}`)
  }

  linha()
  if (!r.ok && r.motivo === 'owner_nao_engine') {
    console.log(`${C.grn}🔒 TRAVA OK:${C.r} lead com owner='${lead.owner}' foi RECUSADO. Nada foi feito.`)
  } else if (r.ok && ensaio) {
    console.log(`${C.grn}✓ Em produção (MODO_ENSAIO=false) este e-mail seria enviado e o estágio avançaria.${C.r}`)
  } else if (r.ok) {
    console.log(`${C.grn}✓ E-mail ENVIADO via Gmail e estágio avançado para '${r.estagio}'.${C.r}`)
  } else {
    console.log(`${C.yel}• Fluxo não executou o envio. Motivo: ${r.motivo}.${C.r}`)
  }
  console.log()
}

main().catch((e) => {
  console.error('Erro no teste:', e)
  process.exit(1)
})
