// Fase 2 do handoff: "encerrar a cadência" precisa ser TERMINAL também no
// caminho persistente (workflows). Uma resposta cancela a execução (Fluxo 2)
// possivelmente no meio de um tick do executor — nem o passo em curso pode
// enviar, nem as escritas de status do próprio executor podem reviver a
// execução. Tudo com MemoryWorkflowStore + ambiente mínimo, sem rede.
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { SupabaseWorkflowStore } from '../store/supabaseStore'
import { criarWorkflow, publicar } from '../versionamento'
import { registrarBlocosPadrao } from '../blocos'
import { inscreverLeadManual, processarExecucao } from '../executor'
import type { AmbienteWorkflow } from '../ambiente'

// Ambiente mínimo: só o que o executor + enviar_email tocam neste cenário. Ao
// enviar, simula a corrida — a resposta do lead cancela a execução "durante"
// o tick (antes do passo seguinte).
function ambiente(store: MemoryWorkflowStore, opts: { cancelarAoEnviar?: string } = {}) {
  const emails: string[] = []
  const amb = {
    organizacaoId: 'org-test',
    simular: false,
    async buscarControleExecucaoCampanha() { return null },
    async sincronizarConclusaoCampanha() { /* nada */ },
    async notificarFalhaExecucao() { /* nada */ },
    async enviarEmailTemplate(leadId: string, template: string) {
      emails.push(template)
      if (opts.cancelarAoEnviar) await store.atualizarExecucao(opts.cancelarAoEnviar, { status: 'cancelado' })
      return { enviado: true, assunto: 'a' }
    },
  } as unknown as AmbienteWorkflow
  return { amb, emails }
}

const registro = registrarBlocosPadrao()

async function publicarCadencia(store: MemoryWorkflowStore) {
  const wf = await criarWorkflow(store, {
    nome: 'Prospecção',
    definicao: {
      gatilho: { tipo: 'manual', config: {} },
      condicoes: [],
      acoes: [
        { id: 'e1', tipo: 'enviar_email', config: { template: 'follow_up_1' } },
        { id: 'e2', tipo: 'enviar_email', config: { template: 'follow_up_2' } },
        { id: 'e3', tipo: 'enviar_email', config: { template: 'follow_up_3' } },
      ],
    },
  })
  await publicar(store, wf.id)
  return wf.id
}

describe('cancelamento é terminal', () => {
  it('execução cancelada no meio do tick: o passo seguinte NÃO envia e o status continua cancelado', async () => {
    const store = new MemoryWorkflowStore()
    const wfId = await publicarCadencia(store)
    const { execucaoId } = await inscreverLeadManual(store, wfId, 'lead-1')
    const { amb, emails } = ambiente(store, { cancelarAoEnviar: execucaoId })

    await processarExecucao(store, registro, amb, execucaoId!)

    expect(emails).toEqual(['follow_up_1']) // o 2º e o 3º não saem
    const ex = await store.buscarExecucao(execucaoId!)
    expect(ex?.status).toBe('cancelado') // o executor não reviveu com em_andamento/concluido
    const eventos = await store.listarEventos(execucaoId!)
    expect(eventos.some((e) => e.tipo === 'envio_pulado_execucao_cancelada')).toBe(true)
  })

  it('store em memória: escrita de status sobre execução cancelada é ignorada; cancelar de novo passa', async () => {
    const store = new MemoryWorkflowStore()
    const wfId = await publicarCadencia(store)
    const { execucaoId } = await inscreverLeadManual(store, wfId, 'lead-1')
    await store.atualizarExecucao(execucaoId!, { status: 'cancelado' })
    await store.atualizarExecucao(execucaoId!, { status: 'em_andamento', passo_atual: 2 })
    expect((await store.buscarExecucao(execucaoId!))?.status).toBe('cancelado')
    expect((await store.buscarExecucao(execucaoId!))?.passo_atual).toBe(0)
  })

  it('store Supabase: o update de status carrega o filtro status <> cancelado (exceto ao cancelar)', async () => {
    const chamadas: { patch: Record<string, unknown>; neq: [string, unknown][] }[] = []
    const client = {
      from() {
        const atual = { patch: {} as Record<string, unknown>, neq: [] as [string, unknown][] }
        chamadas.push(atual)
        const chain = {
          update(p: Record<string, unknown>) { atual.patch = p; return chain },
          eq() { return chain },
          neq(c: string, v: unknown) { atual.neq.push([c, v]); return chain },
          then(resolve: (v: unknown) => void) { resolve({ error: null }) },
        }
        return chain
      },
    } as unknown as SupabaseClient
    const store = new SupabaseWorkflowStore('org-a', client)
    await store.atualizarExecucao('x', { status: 'em_andamento' })
    await store.atualizarExecucao('x', { status: 'cancelado' })
    expect(chamadas[0].neq).toEqual([['status', 'cancelado']])
    expect(chamadas[1].neq).toEqual([])
  })
})
