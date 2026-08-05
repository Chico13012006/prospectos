// Lead scoring dinâmico (sprint item 2.8).
//
// Critério (Chico): quem RESPONDEU tem prioridade, e quanto mais RÁPIDO
// respondeu (tempo entre o envio e a resposta), maior a prioridade. Substitui o
// score fixo (antes sempre 50 na importação) por um cálculo real.
//
// Fórmula (simples e explicável):
//   base 50
//   + 30 se respondeu
//   + até 20 de bônus de VELOCIDADE, decrescente com as horas até responder
//     (≈20 quase imediato, ≈10 em ~24h, ≈5 em ~72h) — 24/(24+h).
//   limitado a [0, 100].
export const SCORE_BASE = 50
export const SCORE_BONUS_RESPONDEU = 30
export const SCORE_BONUS_VELOCIDADE_MAX = 20

export function calcularScore(input: { respondeu: boolean; horasAteResposta?: number | null }): number {
  let s = SCORE_BASE
  if (input.respondeu) {
    s += SCORE_BONUS_RESPONDEU
    const h = input.horasAteResposta
    if (typeof h === 'number' && Number.isFinite(h) && h >= 0) {
      s += Math.round((SCORE_BONUS_VELOCIDADE_MAX * 24) / (24 + h))
    }
  }
  return Math.max(0, Math.min(100, s))
}

// Horas entre o último contato ENVIADO e a resposta. null quando indeterminado
// (sem último contato registrado, datas inválidas ou resposta "antes" do envio).
export function horasEntre(
  ultimoContato?: string | null,
  respostaEm?: Date | string | null,
): number | null {
  if (!ultimoContato || !respostaEm) return null
  const a = new Date(ultimoContato).getTime()
  const b = respostaEm instanceof Date ? respostaEm.getTime() : new Date(respostaEm).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const h = (b - a) / 3600_000
  return h >= 0 ? h : null
}
