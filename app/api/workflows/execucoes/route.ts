// Lista as execuções de workflow da organização (aba Execuções em Automação).
// Somente leitura; requer workflows.view. Escopo de org por resolverAcesso.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { listarExecucoes } from '@/lib/workflows/execucoesRepo'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  if (!permissoes.has('workflows.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const status = new URL(req.url).searchParams.get('status') ?? undefined
  try {
    const execucoes = await listarExecucoes(admin, org, { status })
    return NextResponse.json({ execucoes })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
