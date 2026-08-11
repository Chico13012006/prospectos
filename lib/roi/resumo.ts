import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Resumo de ROI (Fase 8) — derivado das OPORTUNIDADES (Fase 5), org-scoped. Não
// há tabela de ROI: é agregação. `custoMensal` (opcional, workspaceConfig.roi)
// permite o retorno percentual sobre o custo operacional de referência.

export interface ResumoRoi {
  ganho: number          // Σ valor das ganhas
  pipeline: number       // Σ valor das abertas
  perdido: number        // Σ valor das perdidas
  ganhas: number
  perdidas: number
  abertas: number
  taxaConversao: number  // ganhas / (ganhas + perdidas), 0..1
  ticketMedio: number    // ganho / ganhas
  custoMensal: number | null
  roiPercent: number | null // (ganho - custo) / custo, quando custo > 0
}

// Calcula o resumo a partir das linhas (valor, status). Puro/testável.
export function calcularResumo(
  rows: { valor: number | null; status: string }[],
  custoMensal: number | null = null,
): ResumoRoi {
  const soma = (st: string) => rows.filter((r) => r.status === st).reduce((s, r) => s + (r.valor ?? 0), 0)
  const conta = (st: string) => rows.filter((r) => r.status === st).length
  const ganho = soma('ganha')
  const ganhas = conta('ganha')
  const perdidas = conta('perdida')
  const fechadas = ganhas + perdidas
  return {
    ganho,
    pipeline: soma('aberta'),
    perdido: soma('perdida'),
    ganhas,
    perdidas,
    abertas: conta('aberta'),
    taxaConversao: fechadas > 0 ? ganhas / fechadas : 0,
    ticketMedio: ganhas > 0 ? ganho / ganhas : 0,
    custoMensal,
    roiPercent: custoMensal && custoMensal > 0 ? (ganho - custoMensal) / custoMensal : null,
  }
}

// Busca as oportunidades da org (org-scoped) e devolve o resumo.
export async function resumoRoi(admin: SupabaseClient, org: string, custoMensal: number | null = null): Promise<ResumoRoi> {
  const { data, error } = await admin
    .from('oportunidades')
    .select('valor, status')
    .eq('organizacao_id', org)
  if (error) throw new Error(error.message)
  return calcularResumo((data ?? []) as { valor: number | null; status: string }[], custoMensal)
}
