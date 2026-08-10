// Resolução SERVER-SIDE das feature flags para a sessão atual. Devolve apenas
// BOOLEANS — nunca expõe o organizacao_id nem a config crua. A interface pode
// consumir isto para decidir renderização sem tocar em config privada no cliente.
//
// Uso para diagnóstico: logado, GET /api/flags. leadPanelEntidades=true => a
// feature está efetiva para a org da SUA sessão (features.empresaContatoReads).
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { leituraEntidadesLigada } from '@/lib/empresas/flag'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  return NextResponse.json({
    leadPanelEntidades: await leituraEntidadesLigada(admin, org),
  })
}
