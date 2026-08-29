// Helpers HTTP compartilhados pelos endpoints do motor.
import { NextResponse } from 'next/server'
import { engineConfig } from './config'

// Protege os endpoints do motor com INTERNAL_SECRET (chamadas internas/manuais)
// ou CRON_SECRET (enviado automaticamente pelo Vercel Cron no Authorization).
// Aceita header `x-internal-secret` ou `Authorization: Bearer <secret>`.
export function autorizar(req: Request): NextResponse | null {
  const secrets = [engineConfig.internalSecret, process.env.CRON_SECRET ?? ''].filter(Boolean)
  if (secrets.length === 0) {
    return NextResponse.json(
      { erro: 'INTERNAL_SECRET ou CRON_SECRET não configurado no servidor' },
      { status: 500 },
    )
  }
  const header =
    req.headers.get('x-internal-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  if (!secrets.includes(header)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }
  return null
}
