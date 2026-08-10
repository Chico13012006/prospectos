// Cálculo de vencimento de um serviço recorrente. ESPELHO (para preview na UI e
// testes) do trigger calc_vencimento_servico (migration 0019), que é a FONTE DA
// VERDADE — o banco recalcula em toda escrita. Trabalha em UTC e devolve
// 'YYYY-MM-DD'. Casos de borda de fim de mês podem divergir 1 dia do Postgres
// (o banco fixa o vencimento gravado); use este helper só para exibir estimativa.

export type UnidadePeriodicidade = 'dias' | 'meses' | 'anos'

export function calcularVencimento(
  realizadoEm: string | Date | null | undefined,
  valor: number | null | undefined,
  unidade: UnidadePeriodicidade | null | undefined,
): string | null {
  if (!realizadoEm || valor == null || !unidade) return null
  const base = new Date(realizadoEm)
  if (Number.isNaN(base.getTime())) return null
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
  if (unidade === 'dias') d.setUTCDate(d.getUTCDate() + valor)
  else if (unidade === 'meses') d.setUTCMonth(d.getUTCMonth() + valor)
  else if (unidade === 'anos') d.setUTCFullYear(d.getUTCFullYear() + valor)
  else return null
  return d.toISOString().slice(0, 10)
}

// Dias corridos até o vencimento (negativo = já venceu). null se não calculável.
export function diasAteVencimento(vencimentoEm: string | null | undefined, hoje = new Date()): number | null {
  if (!vencimentoEm) return null
  const v = new Date(`${vencimentoEm}T00:00:00.000Z`)
  if (Number.isNaN(v.getTime())) return null
  const h = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))
  return Math.round((v.getTime() - h.getTime()) / 86_400_000)
}

// Está na janela de renovação? (vence em até `antecedenciaDias`, inclusive já vencido)
export function naJanelaRenovacao(vencimentoEm: string | null | undefined, antecedenciaDias: number, hoje = new Date()): boolean {
  const dias = diasAteVencimento(vencimentoEm, hoje)
  return dias !== null && dias <= antecedenciaDias
}
