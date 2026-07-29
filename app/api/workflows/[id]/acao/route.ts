// Ações de ciclo de vida de um workflow (Fase 4 — UI).
// POST { acao: 'publicar' | 'pausar' | 'retomar' }.
//   publicar — congela o rascunho numa versão imutável e a torna vigente
//   pausar   — impede novas execuções (não cancela as em andamento)
//   retomar  — volta um workflow pausado a publicado
import { NextRequest, NextResponse } from 'next/server'
import { resolverContexto } from '@/lib/workflows/api'
import { publicar, pausar, retomar } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json().catch(() => ({}))
    const acao = body?.acao

    if (acao === 'publicar') {
      const { workflow, versao } = await publicar(ctx.store, id, ctx.autorId)
      return NextResponse.json({ workflow, versao })
    }
    if (acao === 'pausar') {
      const workflow = await pausar(ctx.store, id)
      return NextResponse.json({ workflow })
    }
    if (acao === 'retomar') {
      const workflow = await retomar(ctx.store, id)
      return NextResponse.json({ workflow })
    }
    return NextResponse.json({ erro: `Ação inválida: ${acao}` }, { status: 400 })
  } catch (err) {
    console.error('[workflows/:id/acao] erro:', err)
    // Erros de regra do versionamento (rascunho inválido, status errado) → 400.
    const msg = err instanceof Error ? err.message : 'Erro ao executar ação'
    return NextResponse.json({ erro: msg }, { status: 400 })
  }
}
