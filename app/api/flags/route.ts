// Resolução SERVER-SIDE das feature flags para a sessão atual (Fase 4.5 —
// diagnóstico do bug de produção). Devolve apenas BOOLEANS — nunca expõe o
// organizacao_id nem o valor das envs. A interface pode consumir isto para
// decidir renderização sem tocar em env privada no cliente.
//
// Uso para diagnóstico: logado, GET /api/flags. leadPanelEntidades=true => o
// flag está efetivo para a SUA sessão (org correta + env aplicada).
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { leituraEntidadesLigada } from '@/lib/empresas/flag'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { org } = acc.acesso
  return NextResponse.json({
    leadPanelEntidades: leituraEntidadesLigada('lead-panel', org),
  })
}
