/**
 * Teste manual do Fluxo 1 (Executar Ação) contra o Supabase REAL, em ensaio.
 *
 *   npm run engine:test-real <lead_id>
 *
 * - Conecta no Supabase com as credenciais do .env.local (SupabaseStore real).
 * - Carrega o lead, roda executarAcao e imprime o que FARIA: destinatário,
 *   assunto/corpo do e-mail e próximo estágio.
 * - NÃO envia e-mail (MODO_ENSAIO=true → provedor simulado) e NÃO escreve no
 *   banco: as escritas são interceptadas por um wrapper dry-run que só loga.
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
carregarEnvLocal()
process.env.MODO_ENSAIO = 'true' // força ENSAIO neste script, aconteça o que acontecer

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
  const { executarAcao } = await import('../lib/engine/flows/executarAcao')
  const { montarMensagem, proximoEstagio, tipoDoEnvio } = await import('../lib/engine/templates')
  const { engineConfig } = await import('../lib/engine/config')
  type Store = import('../lib/engine/store/store').Store
  type Lead = import('../lib/engine/types').Lead

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

  console.log(`\n${C.b}🧪 TESTE REAL (ENSAIO) — Fluxo 1: Executar Ação${C.r}`)
  console.log(`${C.dim}Supabase: ${url}  | chave: ${usandoService ? 'service_role' : 'anon'} | MODO_ENSAIO=${engineConfig.modoEnsaio}${C.r}`)
  linha()

  const lead = (await dryStore.buscarLead(leadId)) as Lead | null
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

  // 6) Executa de fato o fluxo (com store dry-run + e-mail simulado).
  console.log(`${C.b}Execução de executarAcao() (ensaio):${C.r}`)
  const email = new SimulatedProvider()
  const r = await executarAcao(dryStore, email, { leadId })
  linha()

  console.log(`${C.b}Resultado:${C.r} ${JSON.stringify(r)}`)
  console.log(`  e-mails que teriam sido enviados: ${email.enviados.length}`)
  console.log(`  escritas no banco que teriam ocorrido: ${escritas.length}`)
  if (escritas.length) escritas.forEach((e) => console.log(`    ${C.dim}• ${e}${C.r}`))

  linha()
  if (!r.ok && r.motivo === 'owner_nao_engine') {
    console.log(`${C.grn}🔒 TRAVA OK:${C.r} lead com owner='${lead.owner}' foi RECUSADO. Nada foi feito.`)
  } else if (r.ok) {
    console.log(`${C.grn}✓ Em produção (MODO_ENSAIO=false) este e-mail seria enviado e o estágio avançaria.${C.r}`)
  } else {
    console.log(`${C.yel}• Fluxo não executou o envio. Motivo: ${r.motivo}.${C.r}`)
  }
  console.log()
}

main().catch((e) => {
  console.error('Erro no teste:', e)
  process.exit(1)
})
