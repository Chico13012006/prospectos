// Configuração do workspace (Fase 9): lê/grava organizacoes.configuracoes via o
// ÚNICO ponto de escrita (mesclar/serialize). GET p/ qualquer sessão; PUT exige
// workspace.configure. Sempre org-scoped (organizacoes where id = org da sessão).
import { NextResponse } from 'next/server'
import { resolverAcesso, exigirPermissao } from '@/lib/rbac/servidor'
import { parseWorkspaceConfig, mesclarWorkspaceConfig, type WorkspaceConfigEditavel } from '@/lib/config/workspaceConfig'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  return NextResponse.json({ config: parseWorkspaceConfig(data?.configuracoes), podeEditar: acc.acesso.permissoes.has('workspace.configure') })
}

export async function PUT(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = (await req.json()) as WorkspaceConfigEditavel
  const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const atual = parseWorkspaceConfig(data?.configuracoes)
  const novo = mesclarWorkspaceConfig(atual, {
    nomenclaturas: b.nomenclaturas && typeof b.nomenclaturas === 'object' ? b.nomenclaturas : undefined,
    modulos: b.modulos && typeof b.modulos === 'object' ? b.modulos : undefined,
    renovacaoAntecedenciaDias: typeof b.renovacaoAntecedenciaDias === 'number' ? b.renovacaoAntecedenciaDias : undefined,
    roiCustoMensal: typeof b.roiCustoMensal === 'number' ? b.roiCustoMensal : undefined,
  })
  const { error } = await admin.from('organizacoes').update({ configuracoes: novo }).eq('id', org)
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, config: novo })
}
