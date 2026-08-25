// Cálculo de vencimento de um serviço recorrente. ESPELHO (para preview na UI e
// testes) do trigger calc_vencimento_servico (migration 0019), que é a FONTE DA
// VERDADE — o banco recalcula em toda escrita. Trabalha em UTC e devolve
// 'YYYY-MM-DD'. Casos de borda de fim de mês podem divergir 1 dia do Postgres
// (o banco fixa o vencimento gravado); use este helper só para exibir estimativa.

export type UnidadePeriodicidade = 'dias' | 'meses' | 'anos'

export interface RegistroServicoValidade {
  id: string
  empresa_id: string | null
  vencimento_em: string | null
}

export interface RegistroLeadValidade {
  id: string
  empresa_id: string | null
  data_validade: string | null
}

export interface ValidadeOperacional {
  id: string
  fonte: 'servico' | 'lead_legado'
  empresaId: string | null
  vencimentoEm: string
}

export interface ResumoValidades {
  vencidos: number
  proximos30: number
  entre31e60: number
  proximos60: number
  totalComData: number
  servicos: number
  legados: number
}

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

// Formata um DATE do Postgres sem convertê-lo para o fuso local. `new Date`
// interpreta YYYY-MM-DD como UTC e pode exibir o dia anterior no Brasil.
export function formatarDataIsoSemFuso(valor: string | null | undefined): string {
  const data = valor?.slice(0, 10) ?? ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  if (!m) return ''
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3])
  const verificada = new Date(Date.UTC(ano, mes - 1, dia))
  if (verificada.getUTCFullYear() !== ano || verificada.getUTCMonth() !== mes - 1 || verificada.getUTCDate() !== dia) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

// Consolida a transição para o modelo N serviços por empresa. Um serviço ativo
// é a fonte autoritativa da empresa; data_validade do lead só entra como fallback
// enquanto aquela empresa ainda não tiver serviço recorrente cadastrado. Leads
// sem empresa_id continuam independentes. Isso evita contar a mesma validade nas
// duas estruturas durante a migração gradual.
export function consolidarValidades(
  servicos: RegistroServicoValidade[],
  leads: RegistroLeadValidade[],
): ValidadeOperacional[] {
  const empresasComServico = new Set(servicos.flatMap((s) => s.empresa_id ? [s.empresa_id] : []))
  const vistosLegados = new Set<string>()
  const resultado: ValidadeOperacional[] = []

  for (const servico of servicos) {
    if (!formatarDataIsoSemFuso(servico.vencimento_em)) continue
    resultado.push({
      id: servico.id,
      fonte: 'servico',
      empresaId: servico.empresa_id,
      vencimentoEm: servico.vencimento_em!.slice(0, 10),
    })
  }

  for (const lead of leads) {
    if (!formatarDataIsoSemFuso(lead.data_validade)) continue
    if (lead.empresa_id && empresasComServico.has(lead.empresa_id)) continue
    const chave = lead.empresa_id ? `empresa:${lead.empresa_id}` : `lead:${lead.id}`
    if (vistosLegados.has(chave)) continue
    vistosLegados.add(chave)
    resultado.push({
      id: lead.id,
      fonte: 'lead_legado',
      empresaId: lead.empresa_id,
      vencimentoEm: lead.data_validade!.slice(0, 10),
    })
  }

  return resultado
}

export function resumirValidades(validades: ValidadeOperacional[], hoje = new Date()): ResumoValidades {
  const resumo: ResumoValidades = {
    vencidos: 0,
    proximos30: 0,
    entre31e60: 0,
    proximos60: 0,
    totalComData: validades.length,
    servicos: 0,
    legados: 0,
  }

  for (const validade of validades) {
    if (validade.fonte === 'servico') resumo.servicos++
    else resumo.legados++
    const dias = diasAteVencimento(validade.vencimentoEm, hoje)
    if (dias === null) continue
    if (dias < 0) resumo.vencidos++
    if (dias >= 0 && dias <= 30) resumo.proximos30++
    if (dias >= 31 && dias <= 60) resumo.entre31e60++
    if (dias >= 0 && dias <= 60) resumo.proximos60++
  }

  return resumo
}
