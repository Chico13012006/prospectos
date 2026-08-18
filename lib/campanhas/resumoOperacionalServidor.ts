import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { lerCredenciaisGmail } from '@/lib/engine/email/gmailProvider'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'
import type { ContextoResumoOperacional } from './resumoOperacional'

interface CampanhaParaResumo {
  workflow_id: string | null
  publico: Record<string, unknown> | null
}

interface OpcoesResumoServidor {
  resolverRemetente?: (conta: string) => string | null
}

// Compõe somente contexto de leitura já existente. Toda consulta com service_role
// permanece escopada à organização da sessão; nenhum dado é criado ou alterado.
export async function buscarContextoResumoOperacional(
  admin: SupabaseClient,
  org: string,
  campanha: CampanhaParaResumo,
  opcoes: OpcoesResumoServidor = {},
): Promise<ContextoResumoOperacional> {
  const publico = (campanha.publico ?? {}) as Record<string, unknown>
  const responsavelId = typeof publico.responsavel_id === 'string' ? publico.responsavel_id : null
  const responsavelLegado = typeof publico.responsavel === 'string' && publico.responsavel.trim()
    ? publico.responsavel.trim()
    : null

  let responsavel = responsavelLegado
  if (responsavelId) {
    const { data, error } = await admin
      .from('perfis')
      .select('nome')
      .eq('organizacao_id', org)
      .eq('id', responsavelId)
      .maybeSingle()
    if (error) throw error
    const perfil = data as { nome?: string | null } | null
    responsavel = perfil?.nome?.trim() || responsavelLegado
  }

  const { data: orgRow, error: orgError } = await admin
    .from('organizacoes')
    .select('configuracoes')
    .eq('id', org)
    .maybeSingle()
  if (orgError) throw orgError
  const config = parseWorkspaceConfig((orgRow as { configuracoes?: unknown } | null)?.configuracoes)
  const conta = config.nomenclaturas?.email_conta_key?.trim() || 'followup'
  const resolverRemetente = opcoes.resolverRemetente ?? ((papel: string) => lerCredenciaisGmail(papel)?.user ?? null)
  const remetente = resolverRemetente(conta)

  let workflow: ContextoResumoOperacional['workflow'] = null
  if (campanha.workflow_id) {
    const { data, error } = await admin
      .from('workflows')
      .select('id, nome, status, versao_atual_id, rascunho_definicao')
      .eq('organizacao_id', org)
      .eq('id', campanha.workflow_id)
      .maybeSingle()
    if (error) throw error
    const wf = data as {
      id: string
      nome: string
      status: string
      versao_atual_id: string | null
      rascunho_definicao: DefinicaoWorkflow | null
    } | null

    if (wf) {
      let definicao = wf.rascunho_definicao
      if (wf.versao_atual_id) {
        const { data: versao, error: versaoError } = await admin
          .from('workflow_versoes')
          .select('definicao')
          .eq('organizacao_id', org)
          .eq('workflow_id', wf.id)
          .eq('id', wf.versao_atual_id)
          .maybeSingle()
        if (versaoError) throw versaoError
        definicao = (versao as { definicao?: DefinicaoWorkflow } | null)?.definicao ?? null
      }
      workflow = { id: wf.id, nome: wf.nome, status: wf.status, definicao }
    }
  }

  return { remetente, responsavel, workflow }
}
