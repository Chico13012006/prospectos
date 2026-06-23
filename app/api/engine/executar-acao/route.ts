// FLUXO 1 — Executar ação (motor próprio, sem n8n).
// Coexiste com /api/executar-acao (que continua proxy do n8n). A trava
// owner='engine' garante que este endpoint só age em leads do motor.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { criarMotor, executarAcao } from '@/lib/engine'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado

  let body: { lead_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }
  if (!body.lead_id) {
    return NextResponse.json({ erro: 'lead_id é obrigatório' }, { status: 400 })
  }

  try {
    const motor = criarMotor()
    const r = await executarAcao(motor.store, motor.email, { leadId: body.lead_id })
    return NextResponse.json(r, { status: r.ok ? 200 : 409 })
  } catch (err) {
    console.error('[engine/executar-acao] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}
