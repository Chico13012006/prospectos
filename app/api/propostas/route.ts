import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { leadVisivelNaSessao } from '@/lib/propostas/acessoSessao'
import { salvarProposta } from '@/lib/propostas/salvarPropostaServidor'

export const runtime = 'nodejs'

// POST /api/propostas — salva a proposta montada em Comercial > Simulador.
//
// Organização e autor vêm da SESSÃO (resolverAcesso), nunca do corpo. O corpo
// traz só { leadId, modelo, itens, valorFinal, mensalFinal, entradaFinal };
// tabela, total e o snapshot do PDF são recalculados no servidor. Salvar é
// trabalho de quem acompanha o lead: basta o lead estar visível na carteira do
// usuário (RLS) — como registrar uma nota. A leitura das propostas é direta
// pelo browser, sob a RLS da migration 0045.

export async function POST(req: Request) {
  const r = await resolverAcesso()
  if ('erro' in r) return r.erro
  const { admin, org, user } = r.acesso

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const leadIdBruto = corpo && typeof corpo === 'object' ? (corpo as { leadId?: unknown }).leadId : undefined
  const leadId = typeof leadIdBruto === 'string' ? leadIdBruto.trim() : ''
  if (!leadId) return NextResponse.json({ erro: 'Selecione o lead da proposta.' }, { status: 400 })

  try {
    // CARTEIRA: o comercial só salva proposta de lead que enxerga.
    if (!(await leadVisivelNaSessao(leadId, org))) {
      return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })
    }

    const { data: perfil } = await admin
      .from('perfis')
      .select('nome')
      .eq('id', user.id)
      .eq('organizacao_id', org)
      .maybeSingle()

    const resultado = await salvarProposta(admin, {
      dados: corpo,
      organizacaoId: org,
      usuarioId: user.id,
      usuarioNome: (perfil?.nome as string | null | undefined) ?? user.email ?? null,
    })
    if (!resultado.ok) {
      return NextResponse.json(
        { erro: resultado.mensagem, codigo: resultado.codigo },
        { status: resultado.codigo === 'lead_nao_encontrado' ? 404 : 400 },
      )
    }
    return NextResponse.json({ proposta: resultado.proposta }, { status: 201 })
  } catch (e) {
    console.error('[propostas] erro ao salvar:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível salvar a proposta.' }, { status: 500 })
  }
}
