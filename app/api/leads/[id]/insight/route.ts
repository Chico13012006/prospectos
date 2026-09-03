// Inteligência Comercial por lead (sprint item 4). Gera, sob demanda, uma leitura
// comercial curta via Claude (Haiku, barato) — aderência, oportunidade, dor e
// abordagem. SERVER-ONLY: a ANTHROPIC_API_KEY vive só aqui, nunca no browser.
//
// Auth = sessão do usuário (cookie/SSR), mesmo padrão de app/api/leads/route.ts.
// O lead é buscado com service role MAS escopado à organização do usuário logado
// (organizacao_id), para não vazar leads de outra org mesmo com a admin key.
import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { iaConfigurada } from '@/lib/ia/cliente'
import { gerarInsightComercial, type LeadParaInsight } from '@/lib/ia/insightComercial'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    if (!iaConfigurada()) {
      return NextResponse.json(
        { erro: 'IA não configurada (ANTHROPIC_API_KEY ausente).' },
        { status: 503 },
      )
    }

    const acc = await resolverAcesso()
    if ('erro' in acc) return acc.erro
    const { admin, org } = acc.acesso
    if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    // Busca o lead escopado à org (a admin key ignora RLS — o filtro é a trava).
    const { data: lead, error } = await admin
      .from('leads')
      .select('empresa, segmento, cidade, estado, faixa_funcionarios, contato_cargo, canal_preferencial, estagio')
      .eq('id', id)
      .eq('organizacao_id', org)
      .maybeSingle()
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
    if (!lead) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    const insight = await gerarInsightComercial(lead as LeadParaInsight)
    return NextResponse.json({ insight })
  } catch (err) {
    console.error('[leads/insight POST] erro:', err)
    return NextResponse.json({ erro: 'Erro ao gerar a análise de IA.' }, { status: 500 })
  }
}
