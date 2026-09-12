import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PatchCadastralLead } from './edicao'
import { sincronizarCicloAtual } from '@/lib/laudos/ciclos'

export async function buscarLeadParaEdicao(admin: SupabaseClient, org: string, id: string) {
  const { data, error } = await admin
    .from('leads')
    .select('id, contato_email')
    .eq('id', id)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as { id: string; contato_email: string | null } | null
}

export async function emailPertenceAOutroLead(
  admin: SupabaseClient,
  org: string,
  id: string,
  email: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .eq('organizacao_id', org)
    .ilike('contato_email', email)
    .neq('id', id)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

export async function atualizarDadosCadastraisLead(
  admin: SupabaseClient,
  org: string,
  id: string,
  patch: PatchCadastralLead,
) {
  const { data, error } = await admin
    .from('leads')
    .update(patch)
    .eq('id', id)
    .eq('organizacao_id', org)
    .select('*, usuarios:responsavel_id (id, nome)')
    .maybeSingle()
  if (error) throw new Error(error.message)
  // Editar a validade pela ficha é CORREÇÃO do ciclo atual do laudo — não
  // renovação. Mantém laudo_ciclos em sincronia sem encerrar ciclo.
  if (data && 'data_validade' in patch) {
    await sincronizarCicloAtual(admin, org, id, patch.data_validade ?? null)
  }
  return data
}
