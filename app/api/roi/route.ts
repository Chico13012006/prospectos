// Resumo de ROI da organização (Fase 8), derivado das oportunidades. Requer
// analytics.view. custoMensal vem de organizacoes.configuracoes.roi.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { resumoRoi } from '@/lib/roi/resumo'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('analytics.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  try {
    const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
    const cfg = parseWorkspaceConfig(data?.configuracoes)
    const resumo = await resumoRoi(admin, org, cfg.roi?.custoMensal ?? null)
    return NextResponse.json({ resumo })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
