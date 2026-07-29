// Implementação real do WorkflowStore sobre o Supabase (service_role).
//
// service_role BYPASSA a RLS — portanto o isolamento por organização NESTE
// caminho depende de o Store SEMPRE filtrar (.eq organizacao_id) nas leituras e
// GRAVAR organizacao_id nos inserts. Não é redundância com a RLS: é a única
// proteção do caminho service_role. Mesmo contrato do SupabaseStore do motor.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import type {
  DefinicaoWorkflow,
  StatusExecucao,
  Workflow,
  WorkflowExecucao,
  WorkflowExecucaoEvento,
  WorkflowVersao,
} from '../types'
import type { PatchExecucao, PatchWorkflow, WorkflowStore } from './store'

export class SupabaseWorkflowStore implements WorkflowStore {
  constructor(
    public readonly organizacaoId: string,
    private db: SupabaseClient = createSupabaseAdminClient(),
  ) {
    if (!organizacaoId) throw new Error('SupabaseWorkflowStore exige organizacaoId (multi-tenant).')
  }

  // --- workflows ---
  async criarWorkflow(input: { nome: string; rascunho_definicao?: DefinicaoWorkflow | null }): Promise<Workflow> {
    const { data, error } = await this.db
      .from('workflows')
      .insert({
        organizacao_id: this.organizacaoId,
        nome: input.nome,
        status: 'rascunho',
        rascunho_definicao: input.rascunho_definicao ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as Workflow
  }

  async buscarWorkflow(id: string): Promise<Workflow | null> {
    const { data, error } = await this.db
      .from('workflows')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as Workflow) ?? null
  }

  async listarWorkflows(): Promise<Workflow[]> {
    const { data, error } = await this.db
      .from('workflows')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .order('atualizado_em', { ascending: false })
    if (error) throw error
    return (data as Workflow[]) ?? []
  }

  async atualizarWorkflow(id: string, patch: PatchWorkflow): Promise<void> {
    const { error } = await this.db
      .from('workflows')
      .update(patch)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
    if (error) throw error
  }

  // --- versões ---
  async proximoNumeroVersao(workflowId: string): Promise<number> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('numero')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .order('numero', { ascending: false })
      .limit(1)
    if (error) throw error
    const max = data && data.length > 0 ? (data[0].numero as number) : 0
    return max + 1
  }

  async criarVersao(input: {
    workflow_id: string
    numero: number
    definicao: DefinicaoWorkflow
    publicado_por?: string | null
  }): Promise<WorkflowVersao> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .insert({
        organizacao_id: this.organizacaoId,
        workflow_id: input.workflow_id,
        numero: input.numero,
        definicao: input.definicao,
        publicado_por: input.publicado_por ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as WorkflowVersao
  }

  async buscarVersao(id: string): Promise<WorkflowVersao | null> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowVersao) ?? null
  }

  async listarVersoes(workflowId: string): Promise<WorkflowVersao[]> {
    const { data, error } = await this.db
      .from('workflow_versoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('workflow_id', workflowId)
      .order('numero', { ascending: true })
    if (error) throw error
    return (data as WorkflowVersao[]) ?? []
  }

  // --- execuções ---
  async criarExecucao(input: {
    workflow_id: string
    versao_id: string
    lead_id?: string | null
    status?: StatusExecucao
    proxima_verificacao_em?: string | null
  }): Promise<WorkflowExecucao> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .insert({
        organizacao_id: this.organizacaoId,
        workflow_id: input.workflow_id,
        versao_id: input.versao_id,
        lead_id: input.lead_id ?? null,
        status: input.status ?? 'em_andamento',
        proxima_verificacao_em: input.proxima_verificacao_em ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as WorkflowExecucao
  }

  async buscarExecucao(id: string): Promise<WorkflowExecucao | null> {
    const { data, error } = await this.db
      .from('workflow_execucoes')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as WorkflowExecucao) ?? null
  }

  async atualizarExecucao(id: string, patch: PatchExecucao): Promise<void> {
    const { error } = await this.db
      .from('workflow_execucoes')
      .update(patch)
      .eq('organizacao_id', this.organizacaoId)
      .eq('id', id)
    if (error) throw error
  }

  // --- eventos ---
  async registrarEvento(evento: WorkflowExecucaoEvento): Promise<void> {
    const { error } = await this.db.from('workflow_execucao_eventos').insert({
      organizacao_id: this.organizacaoId,
      execucao_id: evento.execucao_id,
      tipo: evento.tipo,
      detalhe: evento.detalhe ?? null,
    })
    if (error) throw error
  }

  async listarEventos(execucaoId: string): Promise<WorkflowExecucaoEvento[]> {
    const { data, error } = await this.db
      .from('workflow_execucao_eventos')
      .select('*')
      .eq('organizacao_id', this.organizacaoId)
      .eq('execucao_id', execucaoId)
      .order('id', { ascending: true })
    if (error) throw error
    return (data as WorkflowExecucaoEvento[]) ?? []
  }
}
