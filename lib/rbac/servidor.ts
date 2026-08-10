// Resolução de acesso no SERVIDOR (enforcement real — não esconder no front).
// Lê a sessão + o perfil + as permissões efetivas de `perfil_permissoes` e as
// entrega às rotas. `exigirPermissao` é o portão: devolve 401/403 prontos ou o
// contexto autorizado. USA service_role (bypassa RLS), por isso filtra
// organizacao_id EXPLICITAMENTE — é o que garante o isolamento neste caminho.
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { permissoesEfetivas, PERMISSOES_POR_ROLE, type Permissao, type RolePadrao } from './permissoes'

export interface AcessoServidor {
  user: { id: string; email?: string | null }
  admin: SupabaseClient
  org: string
  role: string
  permissoes: Set<Permissao>
}

type Resultado = { erro: NextResponse } | { acesso: AcessoServidor }

// Resolve sessão → perfil → permissões efetivas. Não decide autorização; só
// monta o contexto (ou o erro de auth/organização).
export async function resolverAcesso(): Promise<Resultado> {
  const server = await createSupabaseServerClient()
  const { data: { user } } = await server.auth.getUser()
  if (!user) return { erro: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }) }

  const admin = createSupabaseAdminClient()
  const { data: perfil } = await admin
    .from('perfis').select('role, organizacao_id').eq('id', user.id).maybeSingle()
  if (!perfil?.organizacao_id) {
    return { erro: NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 }) }
  }
  const org = perfil.organizacao_id as string

  const { data: grants } = await admin
    .from('perfil_permissoes').select('permissao').eq('organizacao_id', org).eq('perfil_id', user.id)
  const permissoes = permissoesEfetivas(perfil.role as string, (grants ?? []).map((g) => g.permissao as string))

  return { acesso: { user, admin, org, role: perfil.role as string, permissoes } }
}

// Portão de autorização: exige uma permissão específica. 401 sem sessão, 403 sem
// a permissão. Devolve o contexto autorizado quando passa.
export async function exigirPermissao(perm: Permissao): Promise<Resultado> {
  const r = await resolverAcesso()
  if ('erro' in r) return r
  if (!r.acesso.permissoes.has(perm)) {
    return { erro: NextResponse.json({ erro: 'Sem permissão para esta ação' }, { status: 403 }) }
  }
  return r
}

// Quantos admins a organização tem (para a trava do último administrador).
export async function contarAdmins(admin: SupabaseClient, org: string): Promise<number> {
  const { count } = await admin
    .from('perfis').select('id', { count: 'exact', head: true })
    .eq('organizacao_id', org).eq('role', 'admin')
  return count ?? 0
}

// Ressincroniza as permissões de um perfil ao padrão do seu role. Usado no
// convite (novo membro) e ao trocar o role (o padrão do novo role passa a valer).
// Substitui as linhas anteriores — mantém `perfil_permissoes` coerente com o role.
export async function ressincronizarPermissoes(
  admin: SupabaseClient,
  org: string,
  perfilId: string,
  role: string,
): Promise<void> {
  await admin.from('perfil_permissoes').delete().eq('organizacao_id', org).eq('perfil_id', perfilId)
  const defaults = PERMISSOES_POR_ROLE[role as RolePadrao] ?? []
  if (defaults.length === 0) return
  await admin.from('perfil_permissoes').insert(
    defaults.map((permissao) => ({ organizacao_id: org, perfil_id: perfilId, permissao })),
  )
}
