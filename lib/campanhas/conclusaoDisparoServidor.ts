import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { campanhaEhDisparoUnico } from './configuracaoGuiada'

// Encerra automaticamente uma comunicação somente quando todas as execuções
// daquele disparo já saíram dos estados ativos. Todas as consultas e a escrita
// repetem organizacao_id porque este caminho usa service_role.
export async function concluirDisparoUnicoSeFinalizado(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('campanhas')
    .select('status, tipo, publico')
    .eq('organizacao_id', organizacaoId)
    .eq('id', campanhaId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.status !== 'ativa') return false

  const publico = data.publico && typeof data.publico === 'object' && !Array.isArray(data.publico)
    ? data.publico as Record<string, unknown>
    : null
  const operacao = publico?.operacao && typeof publico.operacao === 'object' && !Array.isArray(publico.operacao)
    ? publico.operacao as Record<string, unknown>
    : null
  const disparoUnico = operacao?.modoEnvio === 'disparo_unico'
    || campanhaEhDisparoUnico(typeof data.tipo === 'string' ? data.tipo : null)
  if (!disparoUnico) return false

  const { count, error: contagemErro } = await admin
    .from('workflow_execucoes')
    .select('id', { count: 'exact', head: true })
    .eq('organizacao_id', organizacaoId)
    .eq('campanha_id', campanhaId)
    .in('status', ['em_andamento', 'aguardando'])
  if (contagemErro) throw contagemErro
  if ((count ?? 0) > 0) return false

  const agora = new Date().toISOString()
  const { error: atualizacaoErro } = await admin
    .from('campanhas')
    .update({ status: 'concluida', concluida_em: agora, atualizado_em: agora })
    .eq('organizacao_id', organizacaoId)
    .eq('id', campanhaId)
    .eq('status', 'ativa')
  if (atualizacaoErro) throw atualizacaoErro
  return true
}
