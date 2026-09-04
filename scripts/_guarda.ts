// Guarda de execução para scripts de `scripts/` que ESCREVEM em produção.
//
// Regra do repositório (AGENTS.md): ensaio é o default; gravar exige
// `--confirmar` explícito na linha de comando. Sem isso, um `npx tsx` digitado
// por engano — ou repetido achando que é idempotente — dispara mutação real
// (criar campanha, apagar execuções, liberar `dry_run` e mandar e-mail).
//
// Dois níveis, conforme o script:
//   anunciarModo()      — leituras rodam; o script decide o que gatilhar.
//   exigirConfirmacao() — barra antes de conectar, quando leitura e mutação
//                         não são separáveis sem reescrever o script.

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', yel: '\x1b[33m', red: '\x1b[31m', grn: '\x1b[32m' }

export function confirmado(): boolean {
  return process.argv.includes('--confirmar')
}

function banner(opcoes: { nome: string; alvo: string; efeitos: string[] }, real: boolean) {
  const { nome, alvo, efeitos } = opcoes
  console.log('══════════════════════════════════════════════════════════')
  console.log(`${C.b}${nome}${C.r}`)
  console.log(`${C.dim}alvo:${C.r} ${alvo}`)
  console.log(
    real
      ? `${C.dim}modo:${C.r} ${C.red}${C.b}CONFIRMADO — grava de verdade${C.r}`
      : `${C.dim}modo:${C.r} ${C.grn}ENSAIO — nenhuma escrita${C.r}`
  )
  console.log(`\n${C.b}Efeitos quando confirmado:${C.r}`)
  for (const e of efeitos) console.log(`  ${C.yel}•${C.r} ${e}`)
  console.log('══════════════════════════════════════════════════════════')
}

/**
 * Imprime o cabeçalho e devolve `true` quando `--confirmar` foi passado.
 * O chamador mantém as leituras rodando e envolve cada mutação no retorno.
 */
export function anunciarModo(opcoes: { nome: string; alvo: string; efeitos: string[] }): boolean {
  const real = confirmado()
  banner(opcoes, real)
  return real
}

/**
 * Guarda dura: sem `--confirmar`, imprime o que faria e encerra com sucesso
 * antes de qualquer conexão. Use quando as mutações estão entremeadas nas
 * leituras e gatilhar cada uma daria um diff grande e arriscado.
 */
export function exigirConfirmacao(opcoes: { nome: string; alvo: string; efeitos: string[] }): void {
  if (anunciarModo(opcoes)) return
  console.log(`\n${C.dim}Nada foi executado. Para gravar de verdade:${C.r}`)
  console.log(`  ${C.b}npx tsx ${processoAtual()} --confirmar${C.r}\n`)
  process.exit(0)
}

/**
 * Recusa aplicar quando o alvo é muito maior que o esperado — protege contra
 * filtro que silenciosamente pegou a base inteira.
 */
export function limiteSeguranca(quantidade: number, maximo: number, rotulo: string): void {
  if (quantidade > maximo) {
    console.error(
      `\n${C.red}${C.b}ABORTADO:${C.r} ${quantidade} ${rotulo} excede o limite de segurança (${maximo}).` +
        `\nConfira o filtro antes de insistir; se o número está certo, ajuste o limite no script.\n`
    )
    process.exit(1)
  }
}

function processoAtual(): string {
  const arg = process.argv[1] ?? 'scripts/<script>.ts'
  return arg.replace(/\\/g, '/').replace(/^.*\/(scripts\/)/, '$1')
}
