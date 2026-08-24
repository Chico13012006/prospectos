// FLUXO 2 (+3) — Detectar resposta e processar a fila (encaminhar ao closer).
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas, processarRespostasOrganizacao } from '@/lib/engine'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    // Multi-tenant: varre cada organização ativa com seu motor escopado. Cada
    // uma só casa respostas com os próprios leads (o Store filtra por org).
    const orgs = await listarOrganizacoesAtivas()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      porOrg[org] = await processarRespostasOrganizacao(org)
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[engine/detectar-resposta] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}
