// Composição de PRODUÇÃO do retorno ao follow-up (server-only): liga o serviço
// puro (retornoFollowup) ao motor de workflows/campanhas real. Nada de regra
// nova aqui — só a costura com o que já existe (mesmo caminho da renovação).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { SupabaseWorkflowStore, inscreverLeadManual } from '@/lib/workflows'
import { agendarExecucoesCampanha } from '@/lib/campanhas/filaDisparoServidor'
import type { CampanhaRetorno, DepsRetornoFollowup } from './retornoFollowup'

const COLS_CAMPANHA = 'id, tipo, status, dry_run, workflow_id'

type CampanhaLinha = { id: string; tipo: string | null; status: string; dry_run: boolean; workflow_id: string | null }

function validarCampanhaRetorno(c: CampanhaLinha | null, origem: 'configurada' | 'unica'): CampanhaRetorno {
  if (!c) return { ok: false, motivo: 'campanha_retorno_invalida', detalhe: `campanha de retorno ${origem} não encontrada nesta organização` }
  if (c.tipo !== 'followup') return { ok: false, motivo: 'campanha_retorno_invalida', detalhe: `campanha de retorno precisa ser de follow-up (tipo atual: ${c.tipo ?? 'nenhum'})` }
  if (c.status !== 'ativa') return { ok: false, motivo: 'campanha_retorno_invalida', detalhe: `campanha de retorno não está ativa (status: ${c.status})` }
  if (c.dry_run !== false) return { ok: false, motivo: 'campanha_retorno_invalida', detalhe: 'campanha de retorno ainda está em modo ensaio (dry_run)' }
  if (!c.workflow_id) return { ok: false, motivo: 'campanha_retorno_invalida', detalhe: 'campanha de retorno sem workflow' }
  return { ok: true, campanhaId: c.id, workflowId: c.workflow_id }
}

/**
 * Campanha de follow-up de retorno da org: a configurada em
 * comercial.campanhaRetornoId; sem config, a ÚNICA campanha de follow-up ativa
 * com envio real. Mais de uma sem config = ambígua (exige configurar).
 */
export async function resolverCampanhaRetornoDaOrg(admin: SupabaseClient, org: string): Promise<CampanhaRetorno> {
  const { data: orgRow, error: e0 } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  if (e0) throw new Error(e0.message)
  const configurada = parseWorkspaceConfig(orgRow?.configuracoes).comercial?.campanhaRetornoId ?? null

  if (configurada) {
    const { data, error } = await admin.from('campanhas').select(COLS_CAMPANHA).eq('organizacao_id', org).eq('id', configurada).maybeSingle()
    if (error) throw new Error(error.message)
    return validarCampanhaRetorno((data as CampanhaLinha | null) ?? null, 'configurada')
  }

  const { data, error } = await admin
    .from('campanhas')
    .select(COLS_CAMPANHA)
    .eq('organizacao_id', org)
    .eq('tipo', 'followup')
    .eq('status', 'ativa')
    .eq('dry_run', false)
    .not('workflow_id', 'is', null)
    .limit(2)
  if (error) throw new Error(error.message)
  const linhas = (data ?? []) as CampanhaLinha[]
  if (linhas.length === 0) return { ok: false, motivo: 'sem_campanha_retorno', detalhe: 'nenhuma campanha de follow-up ativa com envio real; configure a campanha de retorno em Configurações > Distribuição' }
  if (linhas.length > 1) return { ok: false, motivo: 'campanha_retorno_ambigua', detalhe: 'mais de uma campanha de follow-up ativa; configure qual é a de retorno em Configurações > Distribuição' }
  return validarCampanhaRetorno(linhas[0], 'unica')
}

export function montarDepsRetornoFollowup(admin: SupabaseClient): DepsRetornoFollowup {
  return {
    resolverCampanhaRetorno: (org) => resolverCampanhaRetornoDaOrg(admin, org),
    async inscrever(org, workflowId, leadId, campanhaId, cicloChave) {
      // Mesmo enrollment das campanhas/renovação; ciclo_chave dá a idempotência
      // e a origem explícita ('handoff_retorno:<id>').
      const store = new SupabaseWorkflowStore(org, admin)
      const r = await inscreverLeadManual(store, workflowId, leadId, campanhaId, { cicloChave })
      if (!r.execucaoId) throw new Error('execução do follow-up de retorno não pôde ser localizada')
      return { execucaoId: r.execucaoId, jaInscrito: r.jaInscrito }
    },
    async moverLeadParaFollowup(org, leadId) {
      // Estado de follow-up (esteira/Kanban). O motor legado ignora leads com
      // execução ativa, então só o workflow envia. Não mexe em responsavel_id.
      const { error } = await admin
        .from('leads')
        .update({ estagio: 'follow_up', proxima_acao: 'follow_up', proxima_acao_data: null })
        .eq('organizacao_id', org)
        .eq('id', leadId)
      if (error) throw new Error(error.message)
    },
    async agendarPrimeiroEnvio(org, campanhaId, execucaoId) {
      // Fila de campanha (chave campanha+execução → idempotente). Concluída/
      // cancelada é ignorada pelo próprio agendador.
      const store = new SupabaseWorkflowStore(org, admin)
      await agendarExecucoesCampanha(store, org, campanhaId, [execucaoId])
    },
  }
}
