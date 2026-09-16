// Ações de ciclo de vida de um workflow (Fase 4 — UI).
// POST { acao: 'publicar' | 'pausar' | 'retomar' }.
//   publicar — congela o rascunho numa versão imutável e a torna vigente
//   pausar   — impede novas execuções (não cancela as em andamento)
//   retomar  — volta um workflow pausado a publicado
import { NextRequest, NextResponse } from 'next/server'
import { resolverContexto } from '@/lib/workflows/api'
import { publicar, pausar, retomar } from '@/lib/workflows'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { mensagemProblemasTemplate, validarTemplatesDaDefinicao } from '@/lib/workflows/validarTemplates'

export const runtime = 'nodejs'

// Congelar (ou voltar a rodar) uma versão exige que todo template referenciado
// esteja realmente enviável nesta organização. Um tipo que só existe em outra
// organização é simplesmente "ausente" aqui — a resposta não diz mais que isso.
async function recusarPorTemplates(
  organizacaoId: string,
  definicao: unknown,
  acao: 'publicar' | 'retomar',
): Promise<NextResponse | null> {
  if (!definicao) return null
  const problemas = await validarTemplatesDaDefinicao(createSupabaseAdminClient(), organizacaoId, definicao)
  if (problemas.length === 0) return null
  return NextResponse.json(
    { erro: mensagemProblemasTemplate(problemas, acao), templates: problemas },
    { status: 422 },
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json().catch(() => ({}))
    const acao = body?.acao

    if (acao === 'publicar') {
      const atual = await ctx.store.buscarWorkflow(id)
      if (!atual) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })
      const recusa = await recusarPorTemplates(ctx.organizacaoId, atual.rascunho_definicao, 'publicar')
      if (recusa) return recusa
      const { workflow, versao } = await publicar(ctx.store, id, ctx.autorId)
      return NextResponse.json({ workflow, versao })
    }
    if (acao === 'pausar') {
      const workflow = await pausar(ctx.store, id)
      return NextResponse.json({ workflow })
    }
    if (acao === 'retomar') {
      const atual = await ctx.store.buscarWorkflow(id)
      if (!atual) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })
      // Retomar volta a enviar pela versão vigente: ela precisa continuar válida.
      const versaoVigente = atual.versao_atual_id ? await ctx.store.buscarVersao(atual.versao_atual_id) : null
      const recusa = await recusarPorTemplates(ctx.organizacaoId, versaoVigente?.definicao, 'retomar')
      if (recusa) return recusa
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
