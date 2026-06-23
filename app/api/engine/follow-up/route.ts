// FLUXO 4 — Follow-up automatizado (cron, dias úteis).
// Por padrão roda a cadência diária completa (detectar resposta → closer →
// follow-up), que é o alvo natural de um cron. Use ?modo=followup para rodar só
// o Fluxo 4, e ?forcar=1 para ignorar a checagem de dia útil.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { criarMotor, cadenciaDiaria, followUp } from '@/lib/engine'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  const url = new URL(req.url)
  const forcar = url.searchParams.get('forcar') === '1'
  const soFollowup = url.searchParams.get('modo') === 'followup'
  try {
    const motor = criarMotor()
    if (soFollowup) {
      const r = await followUp(motor.store, motor.email)
      return NextResponse.json(r)
    }
    const r = await cadenciaDiaria(motor, { forcar })
    return NextResponse.json(r)
  } catch (err) {
    console.error('[engine/follow-up] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}

// POST para chamadas internas; GET para crons (Vercel Cron usa GET).
export const POST = executar
export const GET = executar
