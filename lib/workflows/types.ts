// Tipos do módulo de Workflows (Fase 2 — schema + versionamento, sem execução).
//
// A DEFINIÇÃO de um workflow é um grafo SERIALIZÁVEL (config, não handlers):
// um gatilho, uma lista de condições e uma lista de ações, cada um identificado
// por `tipo` + um `config` livre. É isso que fica congelado no jsonb de
// workflow_versoes. O mapeamento tipo -> handler (avaliar/executar) é do motor
// de execução (Fase 3) via registro extensível — aqui só guardamos a config.

export interface BlocoConfig {
  // ID ESTÁVEL do passo (gerado em blocoPadrao). Alvos de ramificação
  // (saltar_se.destino) referenciam este id — NÃO o índice — para sobreviver a
  // reordenar/remover passos. Opcional só por retrocompat de defs antigas; a UI
  // garante um id em toda ação carregada (garantirIdsAcoes).
  id?: string
  // Identificador do gatilho/condição/ação. Ex.: 'campo_data_vence',
  // 'lead_respondeu', 'enviar_email'. O registro da Fase 3 resolve o handler.
  tipo: string
  // Parâmetros do bloco (ex.: { campo: 'proxima_acao_data', dias: 3 }).
  config: Record<string, unknown>
}

export interface DefinicaoWorkflow {
  gatilho: BlocoConfig
  condicoes: BlocoConfig[]
  acoes: BlocoConfig[]
}

export type StatusWorkflow = 'rascunho' | 'publicado' | 'pausado'
export type StatusExecucao =
  | 'em_andamento'
  | 'aguardando'
  | 'concluido'
  | 'erro'
  | 'cancelado'

export interface Workflow {
  id: string
  // Presente nas linhas reais; o MemoryStore (testes) pode deixar undefined.
  organizacao_id?: string
  nome: string
  status: StatusWorkflow
  // Versão publicada vigente. Null enquanto o workflow nunca foi publicado.
  versao_atual_id: string | null
  // Rascunho de edição. Null = sem alterações pendentes desde a publicação.
  rascunho_definicao: DefinicaoWorkflow | null
  criado_em: string
  atualizado_em: string
}

export interface WorkflowVersao {
  id: string
  organizacao_id?: string
  workflow_id: string
  numero: number
  definicao: DefinicaoWorkflow // IMUTÁVEL após criada
  publicado_em: string
  publicado_por: string | null
}

export interface WorkflowExecucao {
  id: string
  organizacao_id?: string
  workflow_id: string
  // FIXADO na criação — nunca muda, mesmo que o workflow seja republicado.
  versao_id: string
  lead_id: string | null
  // Campanha que originou o enrollment (null = execução orgânica/manual).
  campanha_id?: string | null
  // Contexto opcional de um processo recorrente. Em renovação, a chave impede
  // reinscrever o mesmo vencimento, mas permite um novo ciclo no futuro.
  ciclo_chave?: string | null
  servico_id?: string | null
  passo_atual: number
  status: StatusExecucao
  proxima_verificacao_em: string | null
  iniciado_em: string
  atualizado_em: string
}

export interface WorkflowExecucaoEvento {
  id?: number
  organizacao_id?: string
  execucao_id: string
  tipo: string
  detalhe?: Record<string, unknown> | null
  criado_em?: string
}
