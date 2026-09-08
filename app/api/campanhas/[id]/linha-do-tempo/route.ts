// Linha do tempo de uma campanha: quem recebeu, respondeu e gerou aviso ao
// closer. Requer campaigns.view. Escopo de organização vem da sessão, nunca do
// payload — a rota recebe apenas o id da campanha.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarCampanha } from '@/lib/campanhas/repository'
import { buscarLinhaDoTempoCampanha } from '@/lib/campanhas/linhaDoTempoServidor'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  try {
    // Confirma que a campanha é desta organização antes de varrer execuções.
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    const linhaDoTempo = await buscarLinhaDoTempoCampanha(admin, org, id)
    return NextResponse.json(linhaDoTempo)
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
