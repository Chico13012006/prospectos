import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { enviarTesteEmailCampanha } from '@/lib/campanhas/testeEmailServidor'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro

  try {
    const body = await req.json().catch(() => ({}))
    const resultado = await enviarTesteEmailCampanha(
      acc.acesso.admin,
      acc.acesso.org,
      body,
    )
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    return NextResponse.json(
      { erro: e instanceof Error ? e.message : 'Não foi possível enviar o teste.' },
      { status: 400 },
    )
  }
}
