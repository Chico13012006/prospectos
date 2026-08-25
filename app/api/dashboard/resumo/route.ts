// Resumo do dashboard (Fase 10): números REAIS agregados por organização, para os
// widgets do topo. Org-scoped em todas as contagens. Quais widgets aparecem é
// configurável (workspaceConfig.dashboardWidgets; vazio = todos).
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig, renovacaoEfetiva } from '@/lib/config/workspaceConfig'
import { consolidarValidades, naJanelaRenovacao, resumirValidades } from '@/lib/servicos/vencimento'

export const runtime = 'nodejs'

const TODOS_WIDGETS = ['leads', 'tarefas', 'oportunidades', 'pipeline', 'campanhas', 'renovacoes'] as const

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const { data: orgRow } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const cfg = parseWorkspaceConfig(orgRow?.configuracoes)
  const antecedencia = renovacaoEfetiva(cfg).antecedenciaDias
  const head = { count: 'exact' as const, head: true }

  const [leadsQ, tarefasQ, oportQ, campQ, servicosQ, validadesLegadasQ, oportRows] = await Promise.all([
    admin.from('leads').select('id', head).eq('organizacao_id', org),
    admin.from('tarefas').select('id', head).eq('organizacao_id', org).in('status', ['aberta', 'em_andamento']),
    admin.from('oportunidades').select('id', head).eq('organizacao_id', org).eq('status', 'aberta'),
    admin.from('campanhas').select('id', head).eq('organizacao_id', org).eq('status', 'ativa'),
    admin.from('servicos_recorrentes').select('id, empresa_id, vencimento_em')
      .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente')
      .order('id', { ascending: true }),
    admin.from('leads').select('id, empresa_id, data_validade')
      .eq('organizacao_id', org).not('data_validade', 'is', null)
      .order('created_at', { ascending: true }).order('id', { ascending: true }),
    admin.from('oportunidades').select('valor').eq('organizacao_id', org).eq('status', 'aberta'),
  ])

  const pipeline = (oportRows.data ?? []).reduce((s: number, r: { valor: number | null }) => s + (r.valor ?? 0), 0)
  const habilitados = cfg.dashboardWidgets && cfg.dashboardWidgets.length > 0 ? cfg.dashboardWidgets : [...TODOS_WIDGETS]
  const validades = consolidarValidades(servicosQ.data ?? [], validadesLegadasQ.data ?? [])
  const validade = resumirValidades(validades)

  return NextResponse.json({
    widgets: habilitados,
    resumo: {
      leads: leadsQ.count ?? 0,
      tarefasAbertas: tarefasQ.count ?? 0,
      oportAbertas: oportQ.count ?? 0,
      pipeline,
      campanhasAtivas: campQ.count ?? 0,
      renovacoesJanela: validades.filter((v) => naJanelaRenovacao(v.vencimentoEm, antecedencia)).length,
      validade,
    },
  })
}
