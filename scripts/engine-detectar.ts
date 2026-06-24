/**
 * Roda o Fluxo 2 (Detectar Resposta) UMA VEZ contra a caixa real do Gmail (IMAP)
 * e o Supabase real, mostrando o que encontrou.
 *
 *   npm run engine:detectar
 *
 * Respeita o MODO_ENSAIO do .env.local:
 *   true  → lê a caixa (sem marcar como lida), não envia ao closer e NÃO escreve
 *           no banco (wrapper dry-run).
 *   false → marca as lidas, avisa o closer de verdade e grava no banco.
 */
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'

// Prefere IPv4: em ambientes com IPv6 parcialmente quebrado o IMAP (993) conecta
// mas estanca no handshake. Inócuo onde o IPv6 funciona.
dns.setDefaultResultOrder('ipv4first')

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

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const linha = () => console.log(C.dim + '─'.repeat(70) + C.r)

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { SupabaseStore } = await import('../lib/engine/store/supabaseStore')
  const { GmailProvider, lerCredenciaisGmail } = await import('../lib/engine/email/gmailProvider')
  const { detectarResposta } = await import('../lib/engine/flows/detectarResposta')
  const { direcionarCloser } = await import('../lib/engine/flows/direcionarCloser')
  const { Queue } = await import('../lib/engine/queue')
  const { engineConfig } = await import('../lib/engine/config')
  type Store = import('../lib/engine/store/store').Store
  type EmailProvider = import('../lib/engine/email/provider').EmailProvider
  type MensagemRecebida = import('../lib/engine/types').MensagemRecebida

  const ensaio = engineConfig.modoEnsaio

  // Credenciais Gmail são obrigatórias (precisamos LER a caixa via IMAP).
  const cred = lerCredenciaisGmail()
  if (!cred) {
    console.log(`${C.red}✗ Faltam GMAIL_USER / GMAIL_APP_PASSWORD no .env.local.${C.r}`)
    process.exit(1)
  }
  const gmail = new GmailProvider(cred)

  // Supabase real.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  const usandoService = !!(sk && !sk.includes('sua_'))
  const key = usandoService ? sk! : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const real: Store = new SupabaseStore(client)

  // Em ensaio, intercepta escritas (não toca no banco).
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
      console.log(`${C.yel}  [DRY-RUN] NÃO escrito → registrarInteracao:${C.r} tipo=${i.tipo}`)
    },
  }
  const store: Store = ensaio ? dryStore : real

  // Wrapper do provedor: imprime o que a caixa retornou antes de seguir o fluxo.
  const emailProxy: EmailProvider = {
    async enviar(p, a, c) {
      // Mostra o AVISO completo que foi montado (em ensaio o provedor real só
      // logaria para+assunto; aqui imprimimos o corpo com o contexto do lead).
      console.log(`\n${C.b}✉️  Aviso montado para o closer:${C.r}`)
      console.log(`  para    : ${p}`)
      console.log(`  assunto : ${a}`)
      console.log(`${C.dim}  ─ corpo ─${C.r}`)
      console.log(c.split('\n').map((l) => '  ' + l).join('\n'))
      return gmail.enviar(p, a, c)
    },
    async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
      const msgs = await gmail.lerCaixaEntrada()
      console.log(`${C.b}Mensagens NÃO LIDAS encontradas na caixa: ${msgs.length}${C.r}`)
      msgs.forEach((m, i) => {
        console.log(`${C.dim}  ${'─'.repeat(66)}${C.r}`)
        console.log(`  [${i + 1}] de       : ${m.de}`)
        console.log(`      assunto  : ${m.assunto}`)
        console.log(`      data     : ${new Date(m.em).toISOString()}`)
        console.log(`      automática: ${m.automatica ? `${C.yel}SIM (será ignorada)${C.r}` : 'não'}`)
        console.log(`      prévia   : ${C.dim}${m.corpo.slice(0, 120).replace(/\n/g, ' ')}${C.r}`)
      })
      return msgs
    },
  }

  console.log(`\n${C.b}📥 DETECTAR RESPOSTA — Fluxo 2 (uma execução)${C.r}`)
  console.log(`${C.dim}Gmail: ${cred.user} | Supabase: ${usandoService ? 'service_role' : 'anon'} | MODO_ENSAIO=${ensaio}${C.r}`)
  console.log(
    ensaio
      ? `${C.yel}Ensaio: lê a caixa (sem marcar lida), não avisa closer nem escreve no banco.${C.r}`
      : `${C.red}${C.b}REAL: marca lidas, avisa o closer e grava no banco.${C.r}`,
  )
  linha()

  const fila = new Queue()
  fila.registrar('direcionar_closer', (p) =>
    direcionarCloser(store, emailProxy, p as { leadId: string; textoResposta: string }),
  )

  const r = await detectarResposta(store, emailProxy, fila)
  await fila.processar() // dispara o Fluxo 3 (closer) para cada resposta

  linha()
  console.log(`${C.b}Resumo:${C.r}`)
  console.log(`  respostas reais detectadas : ${C.grn}${r.respostas}${C.r}`)
  console.log(`  ignoradas (auto/sem match) : ${r.ignoradas}`)
  console.log(`  jobs no escaninho de erro  : ${fila.escaninhoErro().length}`)
  if (ensaio) console.log(`  escritas que TERIAM ocorrido: ${escritas.length}`)
  console.log()
}

main().catch((e) => {
  console.error('Erro no detectar:', e)
  process.exit(1)
})
