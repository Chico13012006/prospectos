// CRUD de topo dos Workflows (Fase 4 — UI). Autenticado pela sessão do usuário;
// a organização vem do perfil (ver lib/workflows/api.ts). NÃO confundir com
// /api/workflows/processar, que é o poll do motor (autorizado por segredo).
import { NextRequest, NextResponse } from 'next/server'
import { resolverContexto } from '@/lib/workflows/api'
import { criarWorkflow } from '@/lib/workflows'

export const runtime = 'nodejs'

// GET — lista os workflows da organização (para a tela de lista).
export async function GET() {
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const workflows = await ctx.store.listarWorkflows()
    return NextResponse.json({ workflows })
  } catch (err) {
    console.error('[workflows] GET erro:', err)
    return NextResponse.json({ erro: 'Erro ao listar workflows' }, { status: 500 })
  }
}

// POST — cria um workflow novo (sempre em rascunho, sem versão publicada).
export async function POST(req: NextRequest) {
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json().catch(() => ({}))
    const nome = typeof body?.nome === 'string' ? body.nome.trim() : ''
    if (!nome) return NextResponse.json({ erro: 'Informe um nome para o workflow.' }, { status: 400 })
    const workflow = await criarWorkflow(ctx.store, { nome })
    return NextResponse.json({ workflow }, { status: 201 })
  } catch (err) {
    console.error('[workflows] POST erro:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao criar workflow'
    return NextResponse.json({ erro: msg }, { status: 400 })
  }
}
