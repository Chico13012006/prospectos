// Versionamento de workflows (Fase 2) — testado contra o MemoryStore, sem rede.
// Cobre os critérios de aceite: publicar cria versão imutável; editar publicado
// não afeta a versão vigente nem execuções em andamento; execução fica presa à
// versão em que começou; pausar impede novas execuções.
import { describe, it, expect } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import {
  criarWorkflow,
  salvarRascunho,
  publicar,
  pausar,
  retomar,
  iniciarExecucao,
} from '../versionamento'
import type { DefinicaoWorkflow } from '../types'

const defV1: DefinicaoWorkflow = {
  gatilho: { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 3 } },
  condicoes: [{ tipo: 'lead_respondeu', config: { respondeu: false } }],
  acoes: [{ tipo: 'enviar_email', config: { template: 'follow_up_1' } }],
}
const defV2: DefinicaoWorkflow = {
  gatilho: { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 5 } },
  condicoes: [],
  acoes: [{ tipo: 'criar_tarefa', config: { titulo: 'Ligar para o lead' } }],
}

describe('versionamento de workflows', () => {
  it('cria workflow em rascunho, sem versão publicada', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    expect(wf.status).toBe('rascunho')
    expect(wf.versao_atual_id).toBeNull()
    expect(wf.rascunho_definicao).toEqual(defV1)
  })

  it('publicar cria versão nº 1 imutável e a torna vigente; zera o rascunho', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    const { workflow, versao } = await publicar(store, wf.id, 'perfil-1')

    expect(versao.numero).toBe(1)
    expect(versao.definicao).toEqual(defV1)
    expect(versao.publicado_por).toBe('perfil-1')
    expect(workflow.status).toBe('publicado')
    expect(workflow.versao_atual_id).toBe(versao.id)

    const salvo = await store.buscarWorkflow(wf.id)
    expect(salvo?.versao_atual_id).toBe(versao.id)
    expect(salvo?.rascunho_definicao).toBeNull() // sem alterações pendentes
    expect(await store.listarVersoes(wf.id)).toHaveLength(1)
  })

  it('não publica sem rascunho (nada para publicar)', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Vazio' }) // sem definição
    await expect(publicar(store, wf.id)).rejects.toThrow()
  })

  it('editar publicado grava rascunho e NÃO altera a versão publicada nem versao_atual_id', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    const { versao: v1 } = await publicar(store, wf.id)

    await salvarRascunho(store, wf.id, defV2)
    const depois = await store.buscarWorkflow(wf.id)

    expect(depois?.versao_atual_id).toBe(v1.id) // ainda aponta a v1
    expect(depois?.rascunho_definicao).toEqual(defV2) // rascunho pendente
    // A versão publicada permanece com a definição original (imutável).
    expect((await store.buscarVersao(v1.id))?.definicao).toEqual(defV1)
    expect(await store.listarVersoes(wf.id)).toHaveLength(1) // ainda só a v1
  })

  it('republicar cria a versão nº 2 e move o vigente; a v1 continua existindo', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    const { versao: v1 } = await publicar(store, wf.id)
    await salvarRascunho(store, wf.id, defV2)
    const { versao: v2 } = await publicar(store, wf.id)

    expect(v2.numero).toBe(2)
    expect(v2.id).not.toBe(v1.id)
    const wfAtual = await store.buscarWorkflow(wf.id)
    expect(wfAtual?.versao_atual_id).toBe(v2.id)
    const versoes = await store.listarVersoes(wf.id)
    expect(versoes.map((v) => v.numero)).toEqual([1, 2])
    expect(versoes[0].definicao).toEqual(defV1) // v1 intacta
    expect(versoes[1].definicao).toEqual(defV2)
  })

  it('execução fica PRESA à versão em que começou, mesmo após republicação', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    const { versao: v1 } = await publicar(store, wf.id)

    const exec = await iniciarExecucao(store, wf.id, { leadId: 'lead-1' })
    expect(exec.versao_id).toBe(v1.id)

    // Republica: o cabeçalho passa a apontar a v2...
    await salvarRascunho(store, wf.id, defV2)
    const { versao: v2 } = await publicar(store, wf.id)
    expect((await store.buscarWorkflow(wf.id))?.versao_atual_id).toBe(v2.id)

    // ...mas a execução em andamento continua na v1.
    const execDepois = await store.buscarExecucao(exec.id)
    expect(execDepois?.versao_id).toBe(v1.id)
    expect(v2.id).not.toBe(v1.id)
  })

  it('iniciar execução registra evento de início com o versao_id fixado', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    const { versao } = await publicar(store, wf.id)
    const exec = await iniciarExecucao(store, wf.id)
    const eventos = await store.listarEventos(exec.id)
    expect(eventos).toHaveLength(1)
    expect(eventos[0].tipo).toBe('execucao_iniciada')
    expect(eventos[0].detalhe?.versao_id).toBe(versao.id)
  })

  it('pausar impede novas execuções; retomar libera de novo', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    await publicar(store, wf.id)

    const pausado = await pausar(store, wf.id)
    expect(pausado.status).toBe('pausado')
    await expect(iniciarExecucao(store, wf.id)).rejects.toThrow()

    const retomado = await retomar(store, wf.id)
    expect(retomado.status).toBe('publicado')
    const exec = await iniciarExecucao(store, wf.id)
    expect(exec.status).toBe('em_andamento')
  })

  it('não inicia execução de workflow em rascunho', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    await expect(iniciarExecucao(store, wf.id)).rejects.toThrow()
  })

  it('só pausa publicado; só retoma pausado', async () => {
    const store = new MemoryWorkflowStore()
    const wf = await criarWorkflow(store, { nome: 'Reativação', definicao: defV1 })
    await expect(pausar(store, wf.id)).rejects.toThrow() // ainda em rascunho
    await publicar(store, wf.id)
    await expect(retomar(store, wf.id)).rejects.toThrow() // publicado, não pausado
  })
})
