// Roda a CADÊNCIA DIÁRIA inteira (detectarResposta → fila/closer → followUp)
// em DRY-RUN total contra Supabase/Gmail reais:
//   - leituras reais (caixa via IMAP + leads/interações no Supabase)
//   - escritas no banco apenas LOGADAS (nada gravado)
//   - MODO_ENSAIO respeitado: nada enviado, e-mails NÃO marcados como lidos
// É a versão segura do engine:cadencia-once (que, pelo contrato do motor, grava).
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { SupabaseStore } = await import('../lib/engine/store/supabaseStore')
  const { GmailProvider, lerCredenciaisGmail } = await import('../lib/engine/email/gmailProvider')
  const { criarMotor, cadenciaDiaria } = await import('../lib/engine')
  const { engineConfig } = await import('../lib/engine/config')
  type Store = import('../lib/engine/store/store').Store
  type EmailProvider = import('../lib/engine/email/provider').EmailProvider

  if (!engineConfig.modoEnsaio) {
    console.log(`${C.red}Abortado: rode com MODO_ENSAIO=true (este script é dry-run).${C.r}`)
    process.exit(1)
  }
  const cred = lerCredenciaisGmail()
  if (!cred) {
    console.log(`${C.red}Faltam GMAIL_USER / GMAIL_APP_PASSWORD no .env.local.${C.r}`)
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
  const key = sk && !sk.includes('sua_') ? sk : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const real: Store = new SupabaseStore(client)

  // Wrapper DRY-RUN: leituras passam adiante; escritas só logam.
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
      escritas.push(`UPDATE leads ${JSON.stringify(patch)} WHERE id=${id}`)
      console.log(`${C.yel}  [DRY-RUN] NÃO escrito → atualizarLead(${id}):${C.r} ${JSON.stringify(patch)}`)
    },
    async registrarInteracao(i) {
      escritas.push(`INSERT interacoes lead=${i.lead_id} tipo=${i.tipo}`)
      console.log(`${C.yel}  [DRY-RUN] NÃO escrito → registrarInteracao:${C.r} lead=${i.lead_id} tipo=${i.tipo} canal=${i.canal}`)
    },
  }

  const gmail = new GmailProvider(cred)
  // Proxy de e-mail: imprime o que SERIA enviado (corpo completo) e delega ao
  // GmailProvider, que em ensaio só loga (não envia) e não marca lidas.
  const email: EmailProvider = {
    async enviar(para, assunto, corpo) {
      console.log(`\n${C.b}✉️  E-mail que SERIA enviado:${C.r}`)
      console.log(`  para    : ${para}`)
      console.log(`  assunto : ${assunto}`)
      console.log(`${C.dim}  ─ corpo ─${C.r}`)
      console.log(corpo.split('\n').map((l) => '  ' + l).join('\n'))
      return gmail.enviar(para, assunto, corpo)
    },
    lerCaixaEntrada: () => gmail.lerCaixaEntrada(),
  }

  console.log(`\n${C.b}🧪 CADÊNCIA DIÁRIA — DRY-RUN (ensaio, sem escrever, sem marcar lidas)${C.r}`)
  console.log(`${C.dim}Gmail: ${cred.user} | MODO_ENSAIO=${engineConfig.modoEnsaio} | maxFollowups=${engineConfig.maxFollowups} | maxEnviosDia=${engineConfig.maxEnviosDia}${C.r}`)
  console.log(C.dim + '─'.repeat(70) + C.r)

  const motor = criarMotor({ store: dryStore, email })
  const r = await cadenciaDiaria(motor, { forcar: true })

  console.log(C.dim + '─'.repeat(70) + C.r)
  console.log(`${C.b}Resumo:${C.r} ${JSON.stringify(r)}`)
  console.log(`  escritas que TERIAM ocorrido: ${escritas.length}`)
  escritas.forEach((e) => console.log(`    ${C.dim}• ${e}${C.r}`))
  process.exit(0)
}

main().catch((e) => {
  console.error('Erro na cadência dry-run:', e)
  process.exit(1)
})
