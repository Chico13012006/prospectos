// Runner de teste (npm run engine:cadencia-once).
// Roda a cadência diária UMA vez (forcar=true ignora a checagem de dia útil) e sai.
// Respeita MODO_ENSAIO do .env.local: em ensaio o envio é só logado, mas as
// escritas no banco acontecem (contrato do motor), restritas a owner='engine'.
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

async function main() {
  const { rodarCadencia } = await import('../lib/engine/scheduler')
  const r = await rodarCadencia({ forcar: true })
  console.log('\nCadência concluída:', JSON.stringify(r))
  process.exit(0)
}

main().catch((e) => {
  console.error('Erro na cadência:', e)
  process.exit(1)
})
