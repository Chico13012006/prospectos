// Comandos do grupo comercial (Fase 4) — PURO: referência curta e parser.
//
// O grupo responde ao check-in com um comando DETERMINÍSTICO:
//   "#A82F31 1" → continuar com o comercial
//   "#A82F31 2" → voltar para follow-up automático
// Nada de IA, nome de empresa ou "última mensagem": só código + dígito.
//
// Código de referência: 6 caracteres de um alfabeto sem ambiguidade visual
// (sem I/O/0/1), único por organização (índice em comercial_handoff_notificacoes.
// codigo_ref, migration 0044). Colisão no sorteio → o serviço sorteia outro.

export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const TAMANHO_CODIGO = 6

export type ComandoGrupo = '1' | '2'

export const DESCRICAO_COMANDO: Record<ComandoGrupo, string> = {
  '1': 'Continuar comigo',
  '2': 'Voltar para follow-up',
}

// Sorteio injetável (testes usam sequência fixa).
export function gerarCodigoRef(aleatorio: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    s += ALFABETO_CODIGO[Math.floor(aleatorio() * ALFABETO_CODIGO.length) % ALFABETO_CODIGO.length]
  }
  return s
}

// Normaliza o que o humano digita: maiúsculas, e os caracteres ambíguos que o
// alfabeto não usa viram os equivalentes (O→0? não — o alfabeto não tem 0/1/I/O,
// então o/i/l digitados por engano NÃO casam; melhor recusar do que adivinhar).
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().toUpperCase()
}

export function codigoValido(codigo: string): boolean {
  return new RegExp(`^[${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}}$`).test(codigo)
}

export type InterpretacaoComando =
  // "#CODIGO 1" / "#CODIGO 2" (separador opcional: espaço, hífen, dois-pontos)
  | { tipo: 'comando'; codigo: string; comando: ComandoGrupo }
  // Tem "#CODIGO" mas o resto não é um comando conhecido → registrar como inválido
  | { tipo: 'comando_invalido'; codigo: string; texto: string }
  // Sem referência "#..." → conversa normal do grupo, não é para a ProspectOS
  | { tipo: 'sem_comando' }

const RE_REFERENCIA = /#\s?([A-Za-z0-9]{4,12})\b/
const RE_COMANDO = /#\s?([A-Za-z0-9]{4,12})\b\s*(?:[-–—:]\s*)?([0-9])\b/

/**
 * Interpreta o texto de uma mensagem do grupo. Só a PRIMEIRA referência conta.
 * O dígito precisa vir logo depois do código (com ou sem separador) — "#ABC123 1"
 * e "#ABC123 - 2" valem; "1 #ABC123" ou "#ABC123 continuar" não.
 */
export function interpretarComandoGrupo(texto: string): InterpretacaoComando {
  const t = (texto ?? '').trim()
  const ref = RE_REFERENCIA.exec(t)
  if (!ref) return { tipo: 'sem_comando' }
  const codigo = normalizarCodigo(ref[1])
  const cmd = RE_COMANDO.exec(t)
  if (!cmd || normalizarCodigo(cmd[1]) !== codigo) return { tipo: 'comando_invalido', codigo, texto: t }
  const digito = cmd[2]
  if (digito !== '1' && digito !== '2') return { tipo: 'comando_invalido', codigo, texto: t }
  return { tipo: 'comando', codigo, comando: digito }
}
