// Helper de contexto para as rotas de UI de Workflows (Fase 4).
//
// Mesmo padrão de /api/configuracoes/motor: autentica pela SESSÃO do usuário
// logado (createSupabaseServerClient) e resolve a organização por
// perfis.organizacao_id. O WorkflowStore usa service_role (bypassa RLS), então
// o filtro por org DENTRO do store é o que mantém o isolamento — por isso a org
// vem sempre do perfil do usuário autenticado, nunca do corpo da requisição.
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { SupabaseWorkflowStore } from './store/supabaseStore'

export interface ContextoWorkflows {
  store: SupabaseWorkflowStore
  organizacaoId: string
  // UUID do usuário (perfis.id) para carimbar workflow_versoes.publicado_por,
  // que é uuid FK — NÃO usar o e-mail aqui (falha no cast p/ uuid, 22P02).
  autorId: string
}

// Resolve o contexto ou devolve uma NextResponse de erro pronta (401/400).
// Uso: `const ctx = await resolverContexto(); if (ctx instanceof NextResponse) return ctx`.
export async function resolverContexto(): Promise<ContextoWorkflows | NextResponse> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const admin = createSupabaseAdminClient()
  const { data } = await admin.from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle()
  const org = (data?.organizacao_id as string) ?? null
  if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 })

  return {
    store: new SupabaseWorkflowStore(org, admin),
    organizacaoId: org,
    autorId: user.id,
  }
}
