// Helpers HTTP compartilhados pelos endpoints do motor.
import { NextResponse } from 'next/server'
import { engineConfig } from './config'

// Protege os endpoints do motor com o INTERNAL_SECRET (reusa o já existente).
// Aceita header `x-internal-secret` ou `Authorization: Bearer <secret>`.
export function autorizar(req: Request): NextResponse | null {
  const secret = engineConfig.internalSecret
  if (!secret) {
    return NextResponse.json(
      { erro: 'INTERNAL_SECRET não configurado no servidor' },
      { status: 500 },
    )
  }
  const header =
    req.headers.get('x-internal-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  if (header !== secret) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  return null
}
