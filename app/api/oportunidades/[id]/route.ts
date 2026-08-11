// Atualiza uma oportunidade (Fase 5): título, valor, probabilidade, estágio,
// previsão, responsável e status (aberta/ganha/perdida — carimba fechada_em).
// Auth por sessão + escopo de org.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { atualizarOportunidade } from '@/lib/oportunidades/repository'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  try {
    await atualizarOportunidade(admin, org, id, b)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
