// Fachada do módulo de Workflows (Fase 2 — schema + versionamento).
// O motor de execução (registro de gatilhos/condições/ações + poll) é da Fase 3.
import { SupabaseWorkflowStore } from './store/supabaseStore'
import type { SupabaseClient } from '@supabase/supabase-js'

export * from './types'
export type { WorkflowStore, PatchWorkflow, PatchExecucao } from './store/store'
export { SupabaseWorkflowStore } from './store/supabaseStore'
export { MemoryWorkflowStore } from './store/memoryStore'
export {
  criarWorkflow,
  salvarRascunho,
  publicar,
  pausar,
  retomar,
  iniciarExecucao,
  validarDefinicao,
} from './versionamento'

// --- Fase 3: motor de execução ---
export { RegistroWorkflows } from './registro'
export type { Gatilho, Condicao, Acao, CtxExec, CtxGatilho, ResultadoAcao } from './registro'
export { registrarBlocosPadrao } from './blocos'
export { AmbienteSupabase } from './ambiente'
export type { AmbienteWorkflow } from './ambiente'
export { processarExecucao, processarEnrollment, processarTudo, inscreverLeadManual } from './executor'

// Fábrica do store preso a uma organização (mesmo padrão de criarMotor(org)).
export function criarWorkflowStore(organizacaoId: string, client?: SupabaseClient): SupabaseWorkflowStore {
  return new SupabaseWorkflowStore(organizacaoId, client)
}
