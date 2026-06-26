// Helpers do Kanban: prioridade derivada do score + tempo relativo.

export type Prioridade = 'Alta' | 'Média' | 'Baixa'

// Deriva a prioridade do score. Se não houver score (0/ausente), retorna null
// para o card ESCONDER o badge — fica bonito mesmo sem o dado.
export function prioridadeFromScore(score?: number | null): Prioridade | null {
  if (!score || score <= 0) return null
  if (score >= 70) return 'Alta'
  if (score >= 40) return 'Média'
  return 'Baixa'
}

export const prioridadeClasses: Record<Prioridade, string> = {
  Alta: 'bg-red-500/15 text-red-400',
  'Média': 'bg-amber-500/15 text-amber-400',
  Baixa: 'bg-slate-500/15 text-slate-400',
}

// Dias desde uma data ISO (>= 0). null se data ausente/inválida.
export function diasDesde(iso?: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso.substring(0, 10)).getTime()
  if (Number.isNaN(t)) return null
  const dias = Math.floor((Date.now() - t) / 86400000)
  return dias < 0 ? 0 : dias
}

// "há 3d" / "hoje"
export function rotuloDias(dias: number | null): string | null {
  if (dias === null) return null
  return dias === 0 ? 'hoje' : `há ${dias}d`
}
