// Simulação "Testar" (Fase 5): roda o fluxo em modo SIMULAÇÃO — lê leads reais,
// mas NÃO envia e-mail, NÃO cria tarefa, NÃO muta lead — e devolve o que
// ACONTECERIA para uma amostra pequena de leads-alvo. Nada é persistido nas
// tabelas de workflow: as execuções/eventos vivem num store EM MEMÓRIA, efêmero.
// Autenticado pela sessão; org do perfil.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { resolverContexto } from '@/lib/workflows/api'
import {
  AmbienteSupabase, MemoryWorkflowStore, registrarBlocosPadrao, processarExecucao,
} from '@/lib/workflows'
import type { DefinicaoWorkflow } from '@/lib/workflows'

export const runtime = 'nodejs'
const AMOSTRA_MAX = 5

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolverContexto()
  if (ctx instanceof NextResponse) return ctx
  try {
    const wf = await ctx.store.buscarWorkflow(id)
    if (!wf) return NextResponse.json({ erro: 'Workflow não encontrado' }, { status: 404 })

    // Definição a simular: a do corpo (form atual, mesmo não salvo) tem
    // prioridade; senão o rascunho salvo; senão a versão publicada.
    const body = await req.json().catch(() => ({}))
    let def: DefinicaoWorkflow | null = (body?.definicao as DefinicaoWorkflow) ?? null
    if (!def) {
      def = wf.rascunho_definicao
      if (!def && wf.versao_atual_id) def = (await ctx.store.buscarVersao(wf.versao_atual_id))?.definicao ?? null
    }
    if (!def?.gatilho?.tipo || !def.acoes?.length) {
      return NextResponse.json({ erro: 'Defina um gatilho e ao menos uma ação para testar.' }, { status: 400 })
    }

    const registro = registrarBlocosPadrao()
    // Ambiente REAL em modo simulação (lê leads de verdade; efeitos são no-op) +
    // store EM MEMÓRIA (execuções/eventos efêmeros, não tocam o banco).
    const ambiente = new AmbienteSupabase(ctx.organizacaoId, { simular: true })
    const mem = new MemoryWorkflowStore()
    const versao = await mem.criarVersao({ workflow_id: id, numero: 1, definicao: def })

    // Alvos reais do gatilho; simula só uma amostra.
    let alvos: string[] = []
    try {
      alvos = await registro.obterGatilho(def.gatilho.tipo).selecionarAlvos({ ambiente, config: def.gatilho.config ?? {} })
    } catch {
      alvos = []
    }
    const amostraIds = alvos.slice(0, AMOSTRA_MAX)

    // Nome dos leads da amostra (para exibir).
    const nomes: Record<string, string> = {}
    if (amostraIds.length) {
      const admin = createSupabaseAdminClient()
      const { data } = await admin
        .from('leads')
        .select('id, empresa, contato_nome')
        .eq('organizacao_id', ctx.organizacaoId)
        .in('id', amostraIds)
      for (const l of data ?? []) {
        nomes[l.id as string] = (l.empresa as string) || (l.contato_nome as string) || (l.id as string)
      }
    }

    // Roda cada lead até concluir. Tempo "futuro" resolve as esperas na hora
    // (a simulação não fica de fato aguardando dias).
    const futuro = new Date(Date.now() + 3650 * 86_400_000).toISOString()
    const amostra: { leadId: string; nome: string; status: string; passos: string[] }[] = []
    for (const leadId of amostraIds) {
      const ex = await mem.criarExecucao({ workflow_id: id, versao_id: versao.id, lead_id: leadId })
      for (let i = 0; i < def.acoes.length + 3; i++) {
        await processarExecucao(mem, registro, ambiente, ex.id, futuro)
        const atual = await mem.buscarExecucao(ex.id)
        if (!atual || ['concluido', 'erro', 'cancelado'].includes(atual.status)) break
      }
      const finalEx = await mem.buscarExecucao(ex.id)
      const passos = (await mem.listarEventos(ex.id)).map((e) => descreverEvento(e.tipo, e.detalhe ?? null))
      amostra.push({ leadId, nome: nomes[leadId] ?? leadId, status: finalEx?.status ?? 'desconhecido', passos })
    }

    return NextResponse.json({ simulado: true, alvos: alvos.length, amostra })
  } catch (err) {
    console.error('[workflows/:id/simular] erro:', err)
    return NextResponse.json({ erro: 'Erro ao simular o workflow' }, { status: 500 })
  }
}

// Traduz um evento do log da execução para uma linha legível do "trace".
function descreverEvento(tipo: string, detalhe: Record<string, unknown> | null): string {
  switch (tipo) {
    case 'execucao_iniciada':
      return 'inscrito'
    case 'acao_executada':
      return `ação: ${String(detalhe?.acao ?? '?')}`
    case 'aguardando':
      return 'espera (persistida)'
    case 'saltou':
      return 'ramificou (salto)'
    case 'condicoes_nao_satisfeitas':
      return `parou — não passou no público (${String(detalhe?.condicao ?? '')})`
    case 'encerrado':
      return 'encerrado'
    case 'concluido':
      return 'concluído'
    case 'erro':
      return `erro: ${String(detalhe?.mensagem ?? '')}`
    default:
      return tipo
  }
}
