// Atualiza / transiciona uma campanha (Fase 7). Requer campaigns.manage.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { atualizarCampanha } from '@/lib/campanhas/repository'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  try {
    await atualizarCampanha(admin, org, id, b)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
