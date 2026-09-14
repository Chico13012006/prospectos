// Round-robin PURO: só a escolha do próximo comercial. Não lê banco, não grava,
// não decide reativação — isso é do handoffService. Determinístico: mesma
// entrada, mesma saída (nunca aleatório).
//
// Ordem estável = nome (pt-BR, sem distinguir maiúsculas/acentos) e, no empate,
// o id. É a mesma ordem em que a tela de Configurações lista os comerciais, então
// quem configura consegue prever a sequência. Uma ordem configurável entra no
// futuro como coluna própria, sem mudar este contrato.
//
// O cursor é o ÚLTIMO comercial que recebeu lead — não um índice. Assim o rodízio
// sobrevive a entrada/saída de gente no meio do ciclo: o próximo é sempre "o
// seguinte ao último, entre os que participam hoje", com volta ao início.

export interface CandidatoRodizio {
  usuarioId: string
  nome: string
  participa: boolean
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

export function ordenarRodizio<T extends { usuarioId: string; nome: string }>(candidatos: readonly T[]): T[] {
  return [...candidatos].sort(
    (a, b) => collator.compare(a.nome, b.nome) || (a.usuarioId < b.usuarioId ? -1 : a.usuarioId > b.usuarioId ? 1 : 0),
  )
}

/**
 * Próximo comercial do rodízio. Recebe TODOS os comerciais conhecidos (com a
 * flag `participa`) para achar a posição do último mesmo que ele tenha saído do
 * rodízio — o próximo é o primeiro participante DEPOIS dele na ordem, com volta
 * ao início.
 *   - nenhum participante → null (quem chama registra "aguardando distribuição")
 *   - cursor vazio, ou último não está mais na lista → primeiro participante
 * Duplicatas por usuarioId são ignoradas (a primeira vale).
 */
export function proximoDoRodizio<T extends CandidatoRodizio>(
  candidatos: readonly T[],
  ultimoUsuarioId: string | null,
): T | null {
  const vistos = new Set<string>()
  const ordenados = ordenarRodizio(candidatos).filter((c) => {
    if (vistos.has(c.usuarioId)) return false
    vistos.add(c.usuarioId)
    return true
  })
  const participantes = ordenados.filter((c) => c.participa)
  if (participantes.length === 0) return null

  const idxUltimo = ultimoUsuarioId ? ordenados.findIndex((c) => c.usuarioId === ultimoUsuarioId) : -1
  if (idxUltimo === -1) return participantes[0]

  for (let passo = 1; passo <= ordenados.length; passo++) {
    const candidato = ordenados[(idxUltimo + passo) % ordenados.length]
    if (candidato.participa) return candidato
  }
  return participantes[0]
}
