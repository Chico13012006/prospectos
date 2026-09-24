// Leitura/escrita das pesquisas salvas no servidor. `org` vem SEMPRE da sessão
// (resolverAcesso); a gravação passa pelo ponto único da config
// (mesclarWorkspaceConfig), que valida e carimba a versão.
import type { SupabaseClient } from '@supabase/supabase-js'
import { mesclarWorkspaceConfig, parseWorkspaceConfig, type PesquisaSalva, type WorkspaceConfig } from '@/lib/config/workspaceConfig'

export async function lerConfig(admin: SupabaseClient, org: string): Promise<WorkspaceConfig> {
  const { data, error } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  if (error) throw new Error(`Falha ao ler a configuração: ${error.message}`)
  return parseWorkspaceConfig(data?.configuracoes)
}

export async function gravarPesquisas(
  admin: SupabaseClient,
  org: string,
  atual: WorkspaceConfig,
  lista: PesquisaSalva[],
): Promise<PesquisaSalva[]> {
  const novo = mesclarWorkspaceConfig(atual, { prospeccaoPesquisas: lista })
  const { error } = await admin.from('organizacoes').update({ configuracoes: novo }).eq('id', org)
  if (error) throw new Error(`Falha ao salvar a pesquisa: ${error.message}`)
  return novo.prospeccaoPesquisas ?? []
}
