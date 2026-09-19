// Loop de teste LOCAL: chama POST /api/workflows/processar em intervalo curto,
// para validar manualmente a cadência de PROSPECÇÃO comprimida por
// PROSPECCAO_TESTE_INTERVALO_MINUTOS (ver lib/workflows/blocos.ts, acaoEsperar)
// sem esperar o cron diário do Vercel. NÃO altera a frequência de produção —
// é só um cliente HTTP batendo no mesmo endpoint que o cron já usa, autorizado
// pelo mesmo INTERNAL_SECRET.
//
//   npm run workflows:tick-teste
//
// Por segurança, só aponta para localhost/127.0.0.1 por padrão — para apontar
// para outra URL é preciso WORKFLOWS_TICK_PERMITIR_REMOTO=true explícito.
// Ctrl+C encerra o loop a qualquer momento.
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yel: '\x1b[33m', grn: '\x1b[32m', red: '\x1b[31m', r: '\x1b[0m' }

const URL_BASE = process.env.WORKFLOWS_TICK_URL ?? 'http://localhost:3000'
const INTERVALO_SEGUNDOS = Number(process.env.WORKFLOWS_TICK_INTERVALO_SEGUNDOS) || 15
const PERMITIR_REMOTO = process.env.WORKFLOWS_TICK_PERMITIR_REMOTO === 'true'

function ehLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1'
  } catch {
    return false
  }
}

async function main() {
  const secret = process.env.INTERNAL_SECRET || process.env.CRON_SECRET
  if (!secret) {
    console.error(`${C.red}✗ INTERNAL_SECRET (ou CRON_SECRET) não configurado no .env.local.${C.r}`)
    process.exit(1)
  }
  if (!ehLocal(URL_BASE) && !PERMITIR_REMOTO) {
    console.error(
      `${C.red}✗ WORKFLOWS_TICK_URL='${URL_BASE}' não é localhost.${C.r}\n` +
      `  Este loop existe para testar localmente. Para apontar para outra URL,\n` +
      `  defina WORKFLOWS_TICK_PERMITIR_REMOTO=true explicitamente — e confira\n` +
      `  se realmente quer bater repetidamente num ambiente compartilhado.`,
    )
    process.exit(1)
  }

  const minutosTeste = process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS
  console.log(`\n${C.b}⏱  TICK MANUAL — /api/workflows/processar${C.r}`)
  console.log(`${C.dim}URL: ${URL_BASE}/api/workflows/processar | intervalo: ${INTERVALO_SEGUNDOS}s | Ctrl+C para parar${C.r}`)
  console.log(
    minutosTeste
      ? `${C.yel}PROSPECCAO_TESTE_INTERVALO_MINUTOS=${minutosTeste} — cadência de prospecção comprimida.${C.r}`
      : `${C.yel}Aviso: PROSPECCAO_TESTE_INTERVALO_MINUTOS não está definido — a espera de prospecção usará dias reais.${C.r}`,
  )
  console.log(C.dim + '─'.repeat(70) + C.r)

  let tick = 0
  // Loop indefinido — a pessoa interrompe com Ctrl+C quando a validação acabar.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    tick += 1
    const agora = new Date().toISOString()
    try {
      const resp = await fetch(`${URL_BASE}/api/workflows/processar`, {
        method: 'POST',
        headers: { 'x-internal-secret': secret },
      })
      const corpo = await resp.json().catch(() => null)
      const cor = resp.ok ? C.grn : C.red
      console.log(`${C.dim}[${agora}]${C.r} tick ${tick} — ${cor}HTTP ${resp.status}${C.r} ${JSON.stringify(corpo)}`)
    } catch (e) {
      console.error(`${C.dim}[${agora}]${C.r} tick ${tick} — ${C.red}falhou: ${e instanceof Error ? e.message : String(e)}${C.r}`)
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_SEGUNDOS * 1000))
  }
}

main().catch((e) => {
  console.error('Erro no loop de tick:', e)
  process.exit(1)
})
