// Runner do scheduler (npm run engine:scheduler).
// Mantém-se rodando: a cada disparo agendado executa a cadência diária.
import { bootstrapEnv } from './_bootstrap'

bootstrapEnv()

async function main() {
  const { iniciarScheduler } = await import('../lib/engine/scheduler')
  iniciarScheduler()
  // node-cron mantém o event loop ativo; o processo segue vivo até Ctrl+C.
}

main().catch((e) => {
  console.error('Erro ao iniciar o scheduler:', e)
  process.exit(1)
})
