// Registro extensível de gatilhos/condições/ações — mesmo padrão de
// Queue.registrar(tipo, handler) do motor de cadência (lib/engine/queue.ts):
// um Map<tipo, handler> em que plugar um tipo novo NÃO exige tocar no executor.
//
// Handlers são puros em relação à persistência: recebem um contexto que expõe
// o `ambiente` (efeitos colaterais reais: enviar e-mail, criar tarefa, ler se o
// lead respondeu, listar leads do gatilho) e o `config` daquele bloco. Assim o
// executor é testável com um ambiente falso.
import type { WorkflowExecucao } from './types'
import type { WorkflowStore } from './store/store'
import type { AmbienteWorkflow } from './ambiente'

// Contexto de ENROLLMENT (avaliação do gatilho para inscrever leads).
export interface CtxGatilho {
  ambiente: AmbienteWorkflow
  config: Record<string, unknown>
}

// Contexto de EXECUÇÃO (avaliação de condição / execução de ação sobre 1 lead).
export interface CtxExec {
  ambiente: AmbienteWorkflow
  store: WorkflowStore
  registro: RegistroWorkflows
  execucao: WorkflowExecucao
  leadId: string | null
  config: Record<string, unknown>
  // Registra um evento no log da execução (workflow_execucao_eventos).
  log(tipo: string, detalhe?: Record<string, unknown>): Promise<void>
}

// Uma ação ou continua o pipeline, ou pede uma espera persistida (suspende a
// execução até `ate`; o poll retoma no mesmo passo depois).
export type ResultadoAcao = { tipo: 'continuar' } | { tipo: 'esperar'; ate: string }

export interface Gatilho {
  tipo: string
  // IDs das entidades (hoje: leads) que satisfazem o gatilho e devem ser inscritas.
  selecionarAlvos(ctx: CtxGatilho): Promise<string[]>
}
export interface Condicao {
  tipo: string
  avaliar(ctx: CtxExec): Promise<boolean>
}
export interface Acao {
  tipo: string
  executar(ctx: CtxExec): Promise<ResultadoAcao>
}

export class RegistroWorkflows {
  private gatilhos = new Map<string, Gatilho>()
  private condicoes = new Map<string, Condicao>()
  private acoes = new Map<string, Acao>()

  registrarGatilho(g: Gatilho) { this.gatilhos.set(g.tipo, g); return this }
  registrarCondicao(c: Condicao) { this.condicoes.set(c.tipo, c); return this }
  registrarAcao(a: Acao) { this.acoes.set(a.tipo, a); return this }

  obterGatilho(tipo: string): Gatilho {
    const g = this.gatilhos.get(tipo)
    if (!g) throw new Error(`Gatilho não registrado: '${tipo}'`)
    return g
  }
  obterCondicao(tipo: string): Condicao {
    const c = this.condicoes.get(tipo)
    if (!c) throw new Error(`Condição não registrada: '${tipo}'`)
    return c
  }
  obterAcao(tipo: string): Acao {
    const a = this.acoes.get(tipo)
    if (!a) throw new Error(`Ação não registrada: '${tipo}'`)
    return a
  }

  tiposRegistrados() {
    return {
      gatilhos: [...this.gatilhos.keys()],
      condicoes: [...this.condicoes.keys()],
      acoes: [...this.acoes.keys()],
    }
  }
}
