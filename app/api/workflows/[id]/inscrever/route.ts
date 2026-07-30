// Inscrição MANUAL de um lead num workflow (Fase 4.6). Uso: gatilho 'manual' ou
// "Inscrever agora" — cria a execução na hora, sem esperar o poll/cron.
// Autenticado pela sessão; org do perfil (ver lib/workflows/api.ts).
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolverContexto } from '@/lib/workflows/api'
import { inscreverLeadManual } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json().catch(() => ({}))
    const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
    if (!leadId) return NextResponse.json({ erro: 'Informe o lead (leadId).' }, { status: 400 })

    // O lead precisa ser da MESMA organização (o store de workflow é org-scoped,
    // mas leadId vem do cliente — validar o isolamento aqui).
    const admin = createSupabaseAdminClient()
    const { data: lead } = await admin
      .from('leads')
      .select('id')
      .eq('organizacao_id', ctx.organizacaoId)
      .eq('id', leadId)
      .maybeSingle()
    if (!lead) return NextResponse.json({ erro: 'Lead não encontrado nesta organização.' }, { status: 404 })

    const r = await inscreverLeadManual(ctx.store, id, leadId)
    return NextResponse.json(r)
  } catch (err) {
    console.error('[workflows/:id/inscrever] erro:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao inscrever o lead'
    return NextResponse.json({ erro: msg }, { status: 400 })
  }
}
