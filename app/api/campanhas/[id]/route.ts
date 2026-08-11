// Lê / atualiza / transiciona uma campanha (Fase 7). GET requer campaigns.view;
// PATCH requer campaigns.manage.
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { atualizarCampanha, buscarCampanha } from '@/lib/campanhas/repository'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    return NextResponse.json({ campanha })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

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
