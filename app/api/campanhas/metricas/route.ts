// Métricas agregadas de campanhas (Fase 2): contatos em cadência com dado real.
// Requer campaigns.view. Não retorna mock — se não calculável, diz "null".
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  // Contatos em cadência = execuções ativas vinculadas a alguma campanha.
  const { count: emCadencia, error } = await admin
    .from('workflow_execucoes')
    .select('id', { count: 'exact', head: true })
    .eq('organizacao_id', org)
    .not('campanha_id', 'is', null)
    .in('status', ['em_andamento', 'aguardando'])

  if (error) {
    return NextResponse.json({ emCadencia: null })
  }

  return NextResponse.json({ emCadencia: emCadencia ?? 0 })
}
