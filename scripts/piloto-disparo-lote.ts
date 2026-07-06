/**
 * Disparo em lote do 1º contato para os leads do PILOTO, com espaçamento entre
 * envios (protege a reputação do domínio — sem rajada de e-mails idênticos).
 *
 *   npm run engine:piloto-lote <lead_id_1> <lead_id_2> ... <lead_id_N>
 *
 * - Usa o motor real (Supabase real + GmailProvider quando há credenciais).
 * - O ENVIO é gated por MODO_ENSAIO (dentro do GmailProvider): em ensaio, só
 *   loga; em MODO_ENSAIO=false, envia de verdade. As escritas no Supabase
 *   (interação + avanço de estágio) acontecem sempre — é assim que o motor
 *   já roda em produção (mesmo contrato do scheduler).
 * - Espera INTERVALO_ENVIO_MIN minutos (do .env.local) entre cada lead.
 *   Ex.: INTERVALO_ENVIO_MIN=10 → 1 disparo a cada 10 minutos.
 * - Idempotente por construção: executarAcao() já recusa reenviar o mesmo
 *   estágio ao mesmo lead (motivo 'ja_enviado'), então rodar o script duas
 *   vezes com os mesmos IDs não duplica envio.
 */
import fs from 'node:fs'
import path from 'node:path'

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

const leadIds = process.argv.slice(2)
if (leadIds.length === 0) {
  console.error('Uso: npm run engine:piloto-lote <lead_id_1> <lead_id_2> ... <lead_id_N>')
  process.exit(1)
}

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }
const linha = () => console.log(C.dim + '─'.repeat(70) + C.r)
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const { criarMotorReal } = await import('../lib/engine/scheduler')
  const { executarAcao } = await import('../lib/engine/flows/executarAcao')
  const { engineConfig } = await import('../lib/engine/config')

  const ensaio = engineConfig.modoEnsaio
  const intervaloMin = engineConfig.intervaloEntreEnviosMin
  const intervaloMs = intervaloMin * 60_000

  console.log(`\n${C.b}🚀 PILOTO — Disparo em lote (Fluxo 1: Executar Ação)${C.r}`)
  console.log(`${C.dim}Leads: ${leadIds.length} | Espaçamento: ${intervaloMin}min | MODO_ENSAIO=${ensaio}${C.r}`)
  console.log(
    ensaio
      ? `${C.yel}Modo ENSAIO: nada será enviado de verdade (só logado).${C.r}`
      : `${C.red}${C.b}Modo REAL: e-mails SERÃO enviados de verdade.${C.r}`,
  )
  if (intervaloMin > 0) {
    const totalMin = (leadIds.length - 1) * intervaloMin
    console.log(`${C.dim}Tempo total estimado do lote: ~${totalMin}min.${C.r}`)
  }
  linha()

  const motor = criarMotorReal()
  let enviados = 0
  let recusados = 0

  for (const [indice, leadId] of leadIds.entries()) {
    if (indice > 0 && intervaloMs > 0) {
      console.log(`${C.dim}⏳ Aguardando ${intervaloMin}min antes do próximo disparo...${C.r}`)
      await esperar(intervaloMs)
    }

    const r = await executarAcao(motor.store, motor.email, { leadId })
    if (r.ok) {
      enviados++
      console.log(`${C.grn}✓ [${indice + 1}/${leadIds.length}] ${leadId} → ${r.estagio}${C.r}`)
    } else {
      recusados++
      console.log(`${C.yel}• [${indice + 1}/${leadIds.length}] ${leadId} → recusado (${r.motivo})${C.r}`)
    }
  }

  linha()
  console.log(`${C.b}Resumo:${C.r} ${enviados} disparados, ${recusados} recusados, ${leadIds.length} total.`)
  console.log()
}

main().catch((e) => {
  console.error('Erro no disparo em lote:', e)
  process.exit(1)
})
