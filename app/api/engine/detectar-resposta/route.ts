// FLUXO 2 (+3) — Detectar resposta e processar a fila (encaminhar ao closer).
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { criarMotor, detectarResposta } from '@/lib/engine'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const motor = criarMotor()
    const r = await detectarResposta(motor.store, motor.email, motor.fila)
    await motor.fila.processar() // dispara o Fluxo 3 para cada resposta
    return NextResponse.json({ ...r, jobsComErro: motor.fila.escaninhoErro().length })
  } catch (err) {
    console.error('[engine/detectar-resposta] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}
