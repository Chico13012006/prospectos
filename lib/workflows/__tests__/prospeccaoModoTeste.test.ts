// MODO DE TESTE da cadência de PROSPECÇÃO (PROSPECCAO_TESTE_INTERVALO_MINUTOS).
// Prova o contrato pedido: (1) sem a env var, dias continuam sendo dias reais,
// mesmo em campanha de prospecção; (2) com a env var, 1 "dia" configurado vira
// N minutos reais SOMENTE para campanhaTipo==='prospeccao' — Lead A avança a
// cadência inteira em minutos; (3) Lead B: cancelar a execução antes do prazo
// (comprimido) vencer impede qualquer follow-up; (4) renovação/organicos nunca
// comprimem, mesmo com a env ligada (escopo estrito).
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { criarWorkflow, publicar } from '../versionamento'
import { registrarBlocosPadrao } from '../blocos'
import { processarTudo, inscreverLeadManual } from '../executor'
import type { AmbienteWorkflow } from '../ambiente'
import type { DefinicaoWorkflow } from '../types'

class AmbienteFake implements AmbienteWorkflow {
  organizacaoId = 'org-teste'
  simular = false
  tipoCampanha: string | null = 'prospeccao'
  emails: { leadId: string; template: string }[] = []

  async buscarControleExecucaoCampanha() {
    return { status: 'ativa' as const, diasSemana: null, disparoUnico: false, tipo: this.tipoCampanha }
  }
  async sincronizarConclusaoCampanha() {}
  async selecionarLeadsComCampoVencendo() { return [] }
  async selecionarLeadsPorCampo() { return [] }
  async selecionarLeadsSemRespostaHaDias() { return [] }
  async leadRespondeu() { return false }
  async lerCampoLead() { return null }
  async criarTarefa() {}
  async criarOportunidade() {}
  async atualizarCampoLead() {}
  async inscreverEmCampanha() {}
  async selecionarLeadsQueResponderamRecente() { return [] }
  async selecionarLeadsSemRespostaInbound() { return [] }
  async selecionarLeadsPorEstagio() { return [] }
  async selecionarLeadsComValidadeVencida() { return [] }

  async enviarEmailTemplate(leadId: string, template: string) {
    this.emails.push({ leadId, template })
    return { enviado: true, assunto: template }
  }
}

// Mesma FORMA que montarDefinicaoCampanha gera: 1ª mensagem + 2 follow-ups de
// 1 dia cada (dias pequenos de propósito — o teste só olha a ORDEM de grandeza
// do tempo restante, não o valor exato).
const DEF: DefinicaoWorkflow = {
  gatilho: { id: 'gatilho-manual', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'email-0', tipo: 'enviar_email', config: { template: 'abordagem_1' } },
    { id: 'espera-1', tipo: 'esperar', config: { dias: 1, horas: 0 } },
    { id: 'email-1', tipo: 'enviar_email', config: { template: 'follow_up_1' } },
    { id: 'espera-2', tipo: 'esperar', config: { dias: 1, horas: 0 } },
    { id: 'email-2', tipo: 'enviar_email', config: { template: 'follow_up_2' } },
  ],
}

const registro = registrarBlocosPadrao()

async function publicarDef() {
  const store = new MemoryWorkflowStore()
  const wf = await criarWorkflow(store, { nome: 'Prospecção modo teste', definicao: DEF })
  await publicar(store, wf.id)
  return { store, wfId: wf.id }
}

const envOriginal = process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS
const UM_DIA_MS = 24 * 60 * 60 * 1000

describe('Modo de teste — cadência de prospecção comprimida', () => {
  afterEach(() => {
    if (envOriginal === undefined) delete process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS
    else process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = envOriginal
  })

  it('sem a env var, a espera usa dias corridos reais mesmo em campanha de prospecção', async () => {
    delete process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    const ex = await store.buscarExecucao(inscricao.execucaoId!)
    expect(ex?.status).toBe('aguardando')
    const faltamMs = new Date(ex!.proxima_verificacao_em!).getTime() - Date.now()
    expect(faltamMs).toBeGreaterThan(UM_DIA_MS - 60_000) // ~1 dia, não minutos

    const eventos = await store.listarEventos(inscricao.execucaoId!)
    expect(eventos.some((e) => e.tipo === 'esperar_comprimido_modo_teste')).toBe(false)
  })

  it('Lead A: com a env var, a cadência inteira (1º contato + 2 follow-ups) avança em minutos', async () => {
    process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = '2'
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb) // envia abordagem_1, entra em espera comprimida (1 dia -> 2min)

    const ex1 = await store.buscarExecucao(inscricao.execucaoId!)
    const faltamMs1 = new Date(ex1!.proxima_verificacao_em!).getTime() - Date.now()
    expect(faltamMs1).toBeLessThan(3 * 60 * 1000) // bem menor que 1 dia — está em minutos

    const eventos1 = await store.listarEventos(inscricao.execucaoId!)
    expect(eventos1.some((e) => e.tipo === 'esperar_comprimido_modo_teste')).toBe(true)

    // Simula 2min30 depois (real) via agoraISO — sem esperar de verdade.
    const t1 = new Date(Date.now() + 2.5 * 60 * 1000).toISOString()
    await processarTudo(store, registro, amb, t1) // follow_up_1, nova espera comprimida

    const t2 = new Date(Date.parse(t1) + 2.5 * 60 * 1000).toISOString()
    await processarTudo(store, registro, amb, t2) // follow_up_2

    expect(amb.emails.map((e) => e.template)).toEqual(['abordagem_1', 'follow_up_1', 'follow_up_2'])
    const exFinal = await store.buscarExecucao(inscricao.execucaoId!)
    expect(exFinal?.status).toBe('concluido')
  })

  it('Lead B: cancelar a execução antes do prazo comprimido vencer impede o follow-up', async () => {
    process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = '2'
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb) // abordagem_1 enviado, aguardando follow_up_1 (comprimido)

    // Mesma ação que detectarResposta.ts dispara ao ver uma resposta humana.
    await store.atualizarExecucao(inscricao.execucaoId!, { status: 'cancelado' })

    const depois = new Date(Date.now() + 5 * 60 * 1000).toISOString() // já passou dos 2min
    await processarTudo(store, registro, amb, depois)

    expect(amb.emails.map((e) => e.template)).toEqual(['abordagem_1']) // nenhum follow-up
    const pendentes = await store.execucoesPendentes(depois)
    expect(pendentes).toHaveLength(0)
  })

  it('renovação não comprime mesmo com a env var ligada (escopo estrito a prospecção)', async () => {
    process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = '2'
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    amb.tipoCampanha = 'renovacao'
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    const ex = await store.buscarExecucao(inscricao.execucaoId!)
    const faltamMs = new Date(ex!.proxima_verificacao_em!).getTime() - Date.now()
    expect(faltamMs).toBeGreaterThan(UM_DIA_MS - 60_000) // continua ~1 dia, não minutos

    const eventos = await store.listarEventos(inscricao.execucaoId!)
    expect(eventos.some((e) => e.tipo === 'esperar_comprimido_modo_teste')).toBe(false)
  })

  it('execução orgânica (sem campanha) não comprime mesmo com a env var ligada', async () => {
    process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = '2'
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1') // sem campanhaId

    await processarTudo(store, registro, amb)

    const ex = await store.buscarExecucao(inscricao.execucaoId!)
    const faltamMs = new Date(ex!.proxima_verificacao_em!).getTime() - Date.now()
    expect(faltamMs).toBeGreaterThan(UM_DIA_MS - 60_000)
  })
})
