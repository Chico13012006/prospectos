// Visão das permissões RBAC (Fase 9, leitura): o catálogo de slugs, o padrão por
// role e as permissões EFETIVAS da sessão atual. Base da aba Permissões.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { PERMISSOES, PERMISSOES_POR_ROLE } from '@/lib/rbac/permissoes'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  return NextResponse.json({
    permissoes: PERMISSOES,
    porRole: PERMISSOES_POR_ROLE,
    minhas: [...acc.acesso.permissoes],
    role: acc.acesso.role,
  })
}
