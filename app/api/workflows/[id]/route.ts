// Detalhe / edição de um workflow (Fase 4 — UI).
//   GET    — workflow + versões + contagem de execuções por status
//   PATCH  — renomear e/ou salvar o rascunho de definição (não publica)
//   DELETE — remover um rascunho que nunca foi publicado (limpeza segura)
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolverContexto } from '@/lib/workflows/api'
import { salvarRascunho } from '@/lib/workflows'
import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows'

export const runtime = 'nodejs'

// Coage o corpo recebido para o formato DefinicaoWorkflow, sem validar semântica
// (o rascunho pode estar incompleto; a validação forte é no publicar).
function coagirDefinicao(raw: unknown): DefinicaoWorkflow {
  const obj = (raw ?? {}) as Record<string, unknown>
  const bloco = (b: unknown): BlocoConfig => {
    const o = (b ?? {}) as Record<string, unknown>
    return { tipo: String(o.tipo ?? ''), config: (o.config as Record<string, unknown>) ?? {} }
  }
  const g = (obj.gatilho ?? {}) as Record<string, unknown>
  return {
    gatilho: { tipo: String(g.tipo ?? ''), config: (g.config as Record<string, unknown>) ?? {} },
    condicoes: Array.isArray(obj.condicoes) ? obj.condicoes.map(bloco) : [],
    acoes: Array.isArray(obj.acoes) ? obj.acoes.map(bloco) : [],
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const workflow = await ctx.store.buscarWorkflow(id)
    if (!workflow) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })
    const versoes = await ctx.store.listarVersoes(id)

    // Contagem de execuções por status (aggregate direto — o store não expõe isto).
    const admin = createSupabaseAdminClient()
    const { data: execs } = await admin
      .from('workflow_execucoes')
      .select('status')
      .eq('organizacao_id', ctx.organizacaoId)
      .eq('workflow_id', id)
    const execucoesPorStatus: Record<string, number> = {}
    for (const e of execs ?? []) {
      const s = (e as { status: string }).status
      execucoesPorStatus[s] = (execucoesPorStatus[s] ?? 0) + 1
    }

    return NextResponse.json({ workflow, versoes, execucoesPorStatus })
  } catch (err) {
    console.error('[workflows/:id] GET erro:', err)
    return NextResponse.json({ erro: 'Erro ao carregar workflow' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const workflow = await ctx.store.buscarWorkflow(id)
    if (!workflow) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })

    const body = await req.json().catch(() => ({}))

    if (typeof body?.nome === 'string') {
      const nome = body.nome.trim()
      if (!nome) return NextResponse.json({ erro: 'O nome não pode ficar vazio.' }, { status: 400 })
      await ctx.store.atualizarWorkflow(id, { nome, atualizado_em: new Date().toISOString() })
    }

    let atualizado = workflow
    if (body?.definicao !== undefined) {
      atualizado = await salvarRascunho(ctx.store, id, coagirDefinicao(body.definicao))
    }

    // Devolve o estado consolidado (renome + rascunho).
    const fresco = (await ctx.store.buscarWorkflow(id)) ?? atualizado
    return NextResponse.json({ workflow: fresco })
  } catch (err) {
    console.error('[workflows/:id] PATCH erro:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao salvar'
    return NextResponse.json({ erro: msg }, { status: 400 })
  }
}

// Só permite apagar um rascunho que NUNCA foi publicado — assim não há versões
// nem execuções órfãs (preserva histórico de qualquer workflow que já rodou).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const workflow = await ctx.store.buscarWorkflow(id)
    if (!workflow) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })
    if (workflow.versao_atual_id || workflow.status !== 'rascunho') {
      return NextResponse.json(
        { erro: 'Só é possível excluir um rascunho que nunca foi publicado. Pause-o em vez disso.' },
        { status: 400 },
      )
    }
    const admin = createSupabaseAdminClient()
    const { error } = await admin
      .from('workflows')
      .delete()
      .eq('organizacao_id', ctx.organizacaoId)
      .eq('id', id)
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[workflows/:id] DELETE erro:', err)
    return NextResponse.json({ erro: 'Erro ao excluir workflow' }, { status: 500 })
  }
}
