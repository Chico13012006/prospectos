// Logger estruturado do motor. Emite uma linha JSON por evento (fácil de
// coletar/filtrar em produção) e mantém um eco humano colorido no console.

export type LogNivel = 'info' | 'ok' | 'aviso' | 'erro'

const cores: Record<LogNivel, string> = {
  info: '\x1b[36m',
  ok: '\x1b[32m',
  aviso: '\x1b[33m',
  erro: '\x1b[31m',
}
const reset = '\x1b[0m'

function emitir(nivel: LogNivel, msg: string, ctx?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  // Linha estruturada (JSON) — a fonte da verdade para coleta.
  const registro = { ts, nivel, escopo: 'engine', msg, ...(ctx ?? {}) }
  const linha = JSON.stringify(registro)
  if (nivel === 'erro') console.error(linha)
  else console.log(linha)
  // Eco humano, só quando rodando num TTY (dev/CLI), nunca atrapalha o JSON.
  if (process.stdout && process.stdout.isTTY) {
    console.log(`${cores[nivel]}[${ts}] ${nivel.toUpperCase()} ${msg}${reset}`)
  }
}

export const log = {
  info: (m: string, ctx?: Record<string, unknown>) => emitir('info', m, ctx),
  ok: (m: string, ctx?: Record<string, unknown>) => emitir('ok', m, ctx),
  aviso: (m: string, ctx?: Record<string, unknown>) => emitir('aviso', m, ctx),
  erro: (m: string, ctx?: Record<string, unknown>) => emitir('erro', m, ctx),
}
