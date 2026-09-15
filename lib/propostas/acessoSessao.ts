import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// As rotas de proposta gravam com service_role (ignora RLS). Antes disso,
// confirmam com o client DA SESSÃO que o usuário enxerga o alvo — é o que
// aplica a carteira comercial (RLS 0029 em leads; 0045 em propostas): o
// comercial só age sobre os leads da própria carteira, o admin sobre a
// organização inteira. Id de outra organização ou fora da carteira = invisível.
// O filtro de organização é explícito além da RLS (defesa em profundidade).

export async function leadVisivelNaSessao(leadId: string, organizacaoId: string): Promise<boolean> {
  const server = await createSupabaseServerClient()
  const { data, error } = await server
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('organizacao_id', organizacaoId)
    .maybeSingle()
  return !error && !!data
}

export async function propostaVisivelNaSessao(propostaId: string, organizacaoId: string): Promise<boolean> {
  const server = await createSupabaseServerClient()
  const { data, error } = await server
    .from('propostas_comerciais')
    .select('id')
    .eq('id', propostaId)
    .eq('organizacao_id', organizacaoId)
    .maybeSingle()
  return !error && !!data
}
