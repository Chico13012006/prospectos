// CRUD de topo dos Workflows (Fase 4 — UI). Autenticado pela sessão do usuário;
// a organização vem do perfil (ver lib/workflows/api.ts). NÃO confundir com
// /api/workflows/processar, que é o poll do motor (autorizado por segredo).
import { NextRequest, NextResponse } from 'next/server'
import { resolverContexto } from '@/lib/workflows/api'
import { criarWorkflow } from '@/lib/workflows'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { apenasWorkflowsAutorais } from '@/lib/campanhas/workflowsInternos'

export const runtime = 'nodejs'

// GET — lista os workflows da organização (para a tela de lista). Enriquece cada
// um com um RESUMO derivado da definição vigente (rascunho se houver; senão a
// versão publicada) — gatilho + nº de etapas/condições — e a contagem de leads
// em execução agora. Tudo dado real; nenhuma coluna nova inventada.
export async function GET() {
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    // Workflows materializados por campanha são internos: aparecem dentro da
    // própria campanha (aba Mensagens), não nesta lista. O motor continua
    // enxergando todos — o filtro é só de apresentação.
    const admin = createSupabaseAdminClient()
    const { data: vinculos, error: erroVinculos } = await admin
      .from('campanhas')
      .select('workflow_id')
      .eq('organizacao_id', ctx.organizacaoId)
      .not('workflow_id', 'is', null)
    if (erroVinculos) throw erroVinculos
    const idsDeCampanha = (vinculos ?? [])
      .map((v) => (v as { workflow_id: string | null }).workflow_id)
      .filter((id): id is string => !!id)

    const workflows = apenasWorkflowsAutorais(await ctx.store.listarWorkflows(), idsDeCampanha)
    const ativos = await ctx.store.contarExecucoesAtivasPorWorkflow()
    const enriquecidos = await Promise.all(
      workflows.map(async (wf) => {
        let def = wf.rascunho_definicao
        if (!def && wf.versao_atual_id) {
          const versao = await ctx.store.buscarVersao(wf.versao_atual_id)
          def = versao?.definicao ?? null
        }
        return {
          ...wf,
          gatilho_tipo: def?.gatilho?.tipo ?? null,
          etapas: def?.acoes?.length ?? 0,
          num_condicoes: def?.condicoes?.length ?? 0,
          em_execucao: ativos[wf.id] ?? 0,
        }
      }),
    )
    return NextResponse.json({ workflows: enriquecidos })
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
