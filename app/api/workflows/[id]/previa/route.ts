// Prévia da TRAVA DE SEGURANÇA (Fase 5): quantos leads o gatilho ATUAL casaria
// agora — a mesma lógica de matching do enrollment (gatilho.selecionarAlvos)
// contra o ambiente real, SEM criar nada. O editor usa isso para avisar antes de
// publicar um workflow de gatilho amplo (evita repetir o quase-incidente de
// centenas de inscrições no 1º tick). Autenticado pela sessão; org do perfil.
import { NextResponse } from 'next/server'
import { resolverContexto } from '@/lib/workflows/api'
import { AmbienteSupabase, registrarBlocosPadrao } from '@/lib/workflows'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const wf = await ctx.store.buscarWorkflow(id)
    if (!wf) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })
    // Definição vigente: rascunho pendente, senão a versão publicada.
    let def = wf.rascunho_definicao
    if (!def && wf.versao_atual_id) def = (await ctx.store.buscarVersao(wf.versao_atual_id))?.definicao ?? null
    if (!def?.gatilho?.tipo) return NextResponse.json({ alvos: 0, gatilho: null })

    const registro = registrarBlocosPadrao()
    const ambiente = new AmbienteSupabase(ctx.organizacaoId)
    let alvos = 0
    try {
      const ids = await registro
        .obterGatilho(def.gatilho.tipo)
        .selecionarAlvos({ ambiente, config: def.gatilho.config ?? {} })
      alvos = ids.length
    } catch {
      // Gatilho manual/desconhecido ou erro de matching → trata como 0 (não trava).
      alvos = 0
    }
    return NextResponse.json({ alvos, gatilho: def.gatilho.tipo })
  } catch (err) {
    console.error('[workflows/:id/previa] erro:', err)
    return NextResponse.json({ erro: 'Erro ao calcular a prévia de inscrições' }, { status: 500 })
  }
}
