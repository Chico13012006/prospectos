import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { aplicarRegraPublicoPorTipo, normalizarPublicoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import { buscarPreviaPublicoCampanha, previaParaCliente } from '@/lib/campanhas/publicoServidor'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  try {
    const body = await req.json().catch(() => ({}))
    const publico = aplicarRegraPublicoPorTipo(
      normalizarPublicoCampanha(body.publico),
      typeof body.tipo === 'string' ? body.tipo : null,
    )
    const previa = await buscarPreviaPublicoCampanha(
      admin,
      org,
      publico,
      typeof body.workflowId === 'string' ? body.workflowId : null,
    )
    return NextResponse.json({ previa: previaParaCliente(previa) })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
