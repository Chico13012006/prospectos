import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResumoExecucoesCampanha {
  total: number
  emAndamento: number
  aguardando: number
  concluidas: number
  canceladas: number
  erros: number
  emailsEnviados: number
  respostas: number
}

const vazio = (): ResumoExecucoesCampanha => ({
  total: 0, emAndamento: 0, aguardando: 0, concluidas: 0,
  canceladas: 0, erros: 0, emailsEnviados: 0, respostas: 0,
})

export async function buscarResumosExecucoesCampanhas(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaIds: string[],
): Promise<Record<string, ResumoExecucoesCampanha>> {
  const idsCampanha = [...new Set(campanhaIds.filter(Boolean))]
  if (!idsCampanha.length) return {}

  const { data, error } = await admin
    .from('workflow_execucoes')
    .select('id, campanha_id, lead_id, status, iniciado_em')
    .eq('organizacao_id', organizacaoId)
    .in('campanha_id', idsCampanha)
  if (error) throw error

  const execucoes = (data ?? []) as Array<{
    id: string; campanha_id: string; lead_id: string | null; status: string; iniciado_em: string
  }>
  const resumos = Object.fromEntries(idsCampanha.map((id) => [id, vazio()]))
  const execucaoParaCampanha = new Map<string, string>()
  const inicios = new Map<string, string>()
  const leadsPorCampanha = new Map<string, Set<string>>()

  for (const execucao of execucoes) {
    const resumo = resumos[execucao.campanha_id] ?? (resumos[execucao.campanha_id] = vazio())
    resumo.total += 1
    if (execucao.status === 'em_andamento') resumo.emAndamento += 1
    if (execucao.status === 'aguardando') resumo.aguardando += 1
    if (execucao.status === 'concluido') resumo.concluidas += 1
    if (execucao.status === 'cancelado') resumo.canceladas += 1
    if (execucao.status === 'erro') resumo.erros += 1
    execucaoParaCampanha.set(execucao.id, execucao.campanha_id)
    const inicioAtual = inicios.get(execucao.campanha_id)
    if (!inicioAtual || execucao.iniciado_em < inicioAtual) inicios.set(execucao.campanha_id, execucao.iniciado_em)
    if (execucao.lead_id) {
      const leads = leadsPorCampanha.get(execucao.campanha_id) ?? new Set<string>()
      leads.add(execucao.lead_id)
      leadsPorCampanha.set(execucao.campanha_id, leads)
    }
  }

  const idsExecucao = execucoes.map((execucao) => execucao.id)
  if (idsExecucao.length) {
    const { data: eventos, error: eventosErro } = await admin
      .from('workflow_execucao_eventos')
      .select('execucao_id, detalhe')
      .eq('organizacao_id', organizacaoId)
      .in('execucao_id', idsExecucao)
      .eq('tipo', 'email_enviado')
    if (eventosErro) throw eventosErro
    for (const evento of eventos ?? []) {
      const row = evento as { execucao_id: string; detalhe?: Record<string, unknown> | null }
      const campanhaId = execucaoParaCampanha.get(row.execucao_id)
      if (campanhaId && row.detalhe?.enviado === true) resumos[campanhaId].emailsEnviados += 1
    }
  }

  const todosLeadIds = [...new Set([...leadsPorCampanha.values()].flatMap((leads) => [...leads]))]
  const inicioGlobal = [...inicios.values()].sort()[0]
  if (todosLeadIds.length && inicioGlobal) {
    const { data: interacoes, error: respostasErro } = await admin
      .from('interacoes')
      .select('lead_id, created_at')
      .eq('organizacao_id', organizacaoId)
      .in('lead_id', todosLeadIds)
      .eq('tipo', 'resposta')
      .gte('created_at', inicioGlobal)
    if (respostasErro) throw respostasErro
    for (const campanhaId of idsCampanha) {
      const leads = leadsPorCampanha.get(campanhaId)
      const inicio = inicios.get(campanhaId)
      if (!leads || !inicio) continue
      resumos[campanhaId].respostas = new Set(
        (interacoes ?? [])
          .filter((item) => {
            const row = item as { lead_id: string; created_at: string }
            return leads.has(row.lead_id) && row.created_at >= inicio
          })
          .map((item) => (item as { lead_id: string }).lead_id),
      ).size
    }
  }

  return resumos
}

export async function buscarResumoExecucoesCampanha(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
): Promise<ResumoExecucoesCampanha> {
  const resumos = await buscarResumosExecucoesCampanhas(admin, organizacaoId, [campanhaId])
  return resumos[campanhaId] ?? vazio()
}
