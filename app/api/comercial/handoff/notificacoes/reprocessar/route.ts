// Reprocessa os avisos de handoff que ficaram pendentes (Z-API fora, grupo
// sem configuração, falha transitória). Endpoint INTERNO (INTERNAL_SECRET /
// CRON_SECRET, como /api/engine/*). Nunca toca o handoff nem o cursor — só o
// outbox. Body opcional: { organizacaoId } para uma org; sem body, todas.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { reprocessarAlertasHandoff } from '@/lib/comercial/handoff/composicao'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const body = (await req.json().catch(() => null)) as { organizacaoId?: unknown } | null
    const orgs = typeof body?.organizacaoId === 'string' && body.organizacaoId.trim()
      ? [body.organizacaoId.trim()]
      : await listarOrganizacoesAtivas()
    const admin = createSupabaseAdminClient()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      try {
        porOrg[org] = await reprocessarAlertasHandoff(admin, org)
      } catch (e) {
        porOrg[org] = { erro: e instanceof Error ? e.message : String(e) }
      }
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[comercial/handoff/notificacoes/reprocessar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
