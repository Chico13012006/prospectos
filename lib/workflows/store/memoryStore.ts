// Store em memória para testes do versionamento — sem rede, determinístico.
// Espelha o contrato do WorkflowStore; não usa organizacao_id (o isolamento
// por org é testado no SupabaseStore/RLS, à parte).
import { randomUUID } from 'node:crypto'
import type {
  DefinicaoWorkflow,
  Workflow,
  WorkflowExecucao,
  WorkflowExecucaoEvento,
  WorkflowVersao,
  StatusExecucao,
} from '../types'
import type { PatchExecucao, PatchWorkflow, WorkflowStore } from './store'

export class MemoryWorkflowStore implements WorkflowStore {
  readonly organizacaoId: string | undefined = undefined
  private workflows = new Map<string, Workflow>()
  private versoes = new Map<string, WorkflowVersao>()
  private execucoes = new Map<string, WorkflowExecucao>()
  private eventos: WorkflowExecucaoEvento[] = []
  private seqEvento = 1

  private agora() {
    return new Date().toISOString()
  }

  async criarWorkflow(input: { nome: string; rascunho_definicao?: DefinicaoWorkflow | null }): Promise<Workflow> {
    const ts = this.agora()
    const wf: Workflow = {
      id: randomUUID(),
      nome: input.nome,
      status: 'rascunho',
      versao_atual_id: null,
      rascunho_definicao: input.rascunho_definicao ?? null,
      criado_em: ts,
      atualizado_em: ts,
    }
    this.workflows.set(wf.id, wf)
    return { ...wf }
  }

  async buscarWorkflow(id: string): Promise<Workflow | null> {
    const wf = this.workflows.get(id)
    return wf ? { ...wf } : null
  }

  async listarWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()].map((w) => ({ ...w }))
  }

  async atualizarWorkflow(id: string, patch: PatchWorkflow): Promise<void> {
    const wf = this.workflows.get(id)
    if (!wf) throw new Error(`workflow ${id} não encontrado`)
    this.workflows.set(id, { ...wf, ...patch })
  }

  async proximoNumeroVersao(workflowId: string): Promise<number> {
    let max = 0
    for (const v of this.versoes.values()) if (v.workflow_id === workflowId && v.numero > max) max = v.numero
    return max + 1
  }

  async criarVersao(input: {
    workflow_id: string
    numero: number
    definicao: DefinicaoWorkflow
    publicado_por?: string | null
  }): Promise<WorkflowVersao> {
    // Guarda a unicidade (workflow_id, numero) como no banco.
    for (const v of this.versoes.values())
      if (v.workflow_id === input.workflow_id && v.numero === input.numero)
        throw new Error(`versão ${input.numero} já existe para o workflow ${input.workflow_id}`)
    const versao: WorkflowVersao = {
      id: randomUUID(),
      workflow_id: input.workflow_id,
      numero: input.numero,
      // Cópia profunda: a versão é imutável e não deve compartilhar referência
      // com o rascunho que continua sendo editado.
      definicao: structuredClone(input.definicao),
      publicado_em: this.agora(),
      publicado_por: input.publicado_por ?? null,
    }
    this.versoes.set(versao.id, versao)
    return structuredClone(versao)
  }

  async buscarVersao(id: string): Promise<WorkflowVersao | null> {
    const v = this.versoes.get(id)
    return v ? structuredClone(v) : null
  }

  async listarVersoes(workflowId: string): Promise<WorkflowVersao[]> {
    return [...this.versoes.values()]
      .filter((v) => v.workflow_id === workflowId)
      .sort((a, b) => a.numero - b.numero)
      .map((v) => structuredClone(v))
  }

  async criarExecucao(input: {
    workflow_id: string
    versao_id: string
    lead_id?: string | null
    campanha_id?: string | null
    status?: StatusExecucao
    proxima_verificacao_em?: string | null
  }): Promise<WorkflowExecucao> {
    const ts = this.agora()
    const ex: WorkflowExecucao = {
      id: randomUUID(),
      workflow_id: input.workflow_id,
      versao_id: input.versao_id,
      lead_id: input.lead_id ?? null,
      campanha_id: input.campanha_id ?? null,
      passo_atual: 0,
      status: input.status ?? 'em_andamento',
      proxima_verificacao_em: input.proxima_verificacao_em ?? null,
      iniciado_em: ts,
      atualizado_em: ts,
    }
    this.execucoes.set(ex.id, ex)
    return { ...ex }
  }

  async buscarExecucao(id: string): Promise<WorkflowExecucao | null> {
    const ex = this.execucoes.get(id)
    return ex ? { ...ex } : null
  }

  async atualizarExecucao(id: string, patch: PatchExecucao): Promise<void> {
    const ex = this.execucoes.get(id)
    if (!ex) throw new Error(`execução ${id} não encontrada`)
    this.execucoes.set(id, { ...ex, ...patch })
  }

  async buscarExecucaoParaLead(workflowId: string, leadId: string): Promise<WorkflowExecucao | null> {
    const execucoes = [...this.execucoes.values()]
      .filter((ex) => ex.workflow_id === workflowId && ex.lead_id === leadId && ex.status !== 'cancelado')
      .sort((a, b) => b.iniciado_em.localeCompare(a.iniciado_em))
    return execucoes[0] ? { ...execucoes[0] } : null
  }

  async existeExecucaoParaLead(workflowId: string, leadId: string): Promise<boolean> {
    for (const ex of this.execucoes.values())
      if (ex.workflow_id === workflowId && ex.lead_id === leadId) return true
    return false
  }

  async execucoesPendentes(agoraISO: string): Promise<WorkflowExecucao[]> {
    const agora = new Date(agoraISO).getTime()
    return [...this.execucoes.values()]
      .filter(
        (ex) =>
          ex.status === 'em_andamento' ||
          (ex.status === 'aguardando' &&
            ex.proxima_verificacao_em != null &&
            new Date(ex.proxima_verificacao_em).getTime() <= agora),
      )
      .sort((a, b) => a.iniciado_em.localeCompare(b.iniciado_em))
      .map((ex) => ({ ...ex }))
  }

  async workflowsPublicados(): Promise<Workflow[]> {
    return [...this.workflows.values()].filter((w) => w.status === 'publicado').map((w) => ({ ...w }))
  }

  async contarExecucoesAtivasPorWorkflow(): Promise<Record<string, number>> {
    const contagem: Record<string, number> = {}
    for (const ex of this.execucoes.values()) {
      if (ex.status === 'em_andamento' || ex.status === 'aguardando') {
        contagem[ex.workflow_id] = (contagem[ex.workflow_id] ?? 0) + 1
      }
    }
    return contagem
  }

  async registrarEvento(evento: WorkflowExecucaoEvento): Promise<void> {
    this.eventos.push({ ...evento, id: this.seqEvento++, criado_em: evento.criado_em ?? this.agora() })
  }

  async listarEventos(execucaoId: string): Promise<WorkflowExecucaoEvento[]> {
    return this.eventos.filter((e) => e.execucao_id === execucaoId).map((e) => ({ ...e }))
  }
}
