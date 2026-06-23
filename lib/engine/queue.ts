// Fila de tarefas em memória COM retry e escaninho de erro (dead-letter).
// Demonstra o conceito hoje; em produção troque por pg-boss (roda no próprio
// Postgres do Supabase) mantendo registrar/enfileirar/processar + retry.
import { log } from './logger'

type Handler = (payload: unknown) => Promise<unknown>

export interface Job {
  id: number
  tipo: string
  payload: unknown
  tentativas: number
  ultimoErro?: string
}

export class Queue {
  private handlers = new Map<string, Handler>()
  private fila: Job[] = []
  private deadLetter: Job[] = []
  private seq = 0
  private readonly maxTentativas: number

  constructor(maxTentativas = 3) {
    this.maxTentativas = maxTentativas
  }

  registrar(tipo: string, handler: Handler) {
    this.handlers.set(tipo, handler)
  }

  enfileirar(tipo: string, payload: unknown = {}) {
    this.fila.push({ id: ++this.seq, tipo, payload, tentativas: 0 })
  }

  pendentes() {
    return this.fila.length
  }

  // Processa tudo que está na fila, com retry e dead-letter.
  async processar() {
    while (this.fila.length > 0) {
      const job = this.fila.shift()!
      const handler = this.handlers.get(job.tipo)
      if (!handler) {
        log.erro(`Sem handler para job`, { tipo: job.tipo, jobId: job.id })
        this.deadLetter.push(job)
        continue
      }
      try {
        await handler(job.payload)
      } catch (e) {
        job.tentativas++
        job.ultimoErro = e instanceof Error ? e.message : String(e)
        if (job.tentativas < this.maxTentativas) {
          log.aviso(`Job falhou; reenfileirando`, {
            tipo: job.tipo,
            jobId: job.id,
            tentativa: job.tentativas,
            erro: job.ultimoErro,
          })
          this.fila.push(job)
        } else {
          log.erro(`Job falhou ${this.maxTentativas}x → escaninho de erro`, {
            tipo: job.tipo,
            jobId: job.id,
            erro: job.ultimoErro,
          })
          this.deadLetter.push(job)
        }
      }
    }
  }

  // Escaninho de erro: jobs que estouraram o número de tentativas.
  escaninhoErro(): readonly Job[] {
    return this.deadLetter
  }
}
