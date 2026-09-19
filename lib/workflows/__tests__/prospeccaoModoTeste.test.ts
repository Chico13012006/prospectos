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

// A org da AmbienteFake acima. A compressão é recortada por ID de organização,
// então os testes precisam casar exatamente este valor para comprimir.
const ORG_TESTE = 'org-teste'
const CHAVES_ENV = ['PROSPECCAO_TESTE_INTERVALO_MINUTOS', 'PROSPECCAO_TESTE_ORGANIZACAO_ID'] as const
const envOriginal = Object.fromEntries(CHAVES_ENV.map((c) => [c, process.env[c]]))
const UM_DIA_MS = 24 * 60 * 60 * 1000

// Liga o modo de teste para a organização indicada. Sem argumento, liga as duas
// envs para a org da AmbienteFake (o caminho que comprime).
function ligarModoTeste(orgId: string | null = ORG_TESTE, minutos: string | null = '2') {
  if (orgId === null) delete process.env.PROSPECCAO_TESTE_ORGANIZACAO_ID
  else process.env.PROSPECCAO_TESTE_ORGANIZACAO_ID = orgId
  if (minutos === null) delete process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS
  else process.env.PROSPECCAO_TESTE_INTERVALO_MINUTOS = minutos
}

// Espera ~1 dia real (não comprimida) + ausência do evento de compressão.
async function esperaEmDiasReais(store: MemoryWorkflowStore, execucaoId: string) {
  const ex = await store.buscarExecucao(execucaoId)
  const faltamMs = new Date(ex!.proxima_verificacao_em!).getTime() - Date.now()
  expect(faltamMs).toBeGreaterThan(UM_DIA_MS - 60_000)
  const eventos = await store.listarEventos(execucaoId)
  expect(eventos.some((e) => e.tipo === 'esperar_comprimido_modo_teste')).toBe(false)
}

describe('Modo de teste — cadência de prospecção comprimida', () => {
  afterEach(() => {
    for (const chave of CHAVES_ENV) {
      const valor = envOriginal[chave]
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
  })

  it('sem a env var, a espera usa dias corridos reais mesmo em campanha de prospecção', async () => {
    ligarModoTeste(null, null)
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

  it('Lead A: com as DUAS envs e a org de teste, a cadência inteira (1º contato + 2 follow-ups) avança em minutos', async () => {
    ligarModoTeste()
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
    ligarModoTeste()
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

  // (E) renovação na org de teste, com as duas envs ligadas.
  it('renovação não comprime mesmo com as envs ligadas na org de teste (escopo estrito a prospecção)', async () => {
    ligarModoTeste()
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    amb.tipoCampanha = 'renovacao'
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    await esperaEmDiasReais(store, inscricao.execucaoId!)
  })

  // (F) execução sem campanha (campanhaTipo null), na org de teste.
  it('execução orgânica (sem campanha) não comprime mesmo com as envs ligadas', async () => {
    ligarModoTeste()
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1') // sem campanhaId

    await processarTudo(store, registro, amb)

    await esperaEmDiasReais(store, inscricao.execucaoId!)
  })
})

// Recorte POR ORGANIZAÇÃO: é o que torna o modo de teste seguro em produção —
// ligar as envs não pode acelerar a cadência de nenhum outro tenant.
describe('Modo de teste — recorte por organização', () => {
  afterEach(() => {
    for (const chave of CHAVES_ENV) {
      const valor = envOriginal[chave]
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
  })

  // (A) prospecção + org de teste + as duas envs → comprime.
  it('(A) prospecção na org configurada, com as duas envs, comprime a espera', async () => {
    ligarModoTeste(ORG_TESTE, '2')
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    const ex = await store.buscarExecucao(inscricao.execucaoId!)
    const faltamMs = new Date(ex!.proxima_verificacao_em!).getTime() - Date.now()
    expect(faltamMs).toBeLessThan(3 * 60 * 1000)

    const eventos = await store.listarEventos(inscricao.execucaoId!)
    const comprimido = eventos.find((e) => e.tipo === 'esperar_comprimido_modo_teste')
    expect(comprimido).toBeTruthy()
    // A evidência registra a organização — o log [MODO TESTE] não pode ser
    // confundido com produção depois.
    expect((comprimido!.detalhe as Record<string, unknown>).organizacaoId).toBe(ORG_TESTE)
  })

  // (B) prospecção + OUTRA organização + as duas envs → NÃO comprime.
  it('(B) prospecção em OUTRA organização, com as duas envs, NÃO comprime', async () => {
    ligarModoTeste(ORG_TESTE, '2')
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    amb.organizacaoId = 'outra-organizacao' // env aponta para ORG_TESTE
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    await esperaEmDiasReais(store, inscricao.execucaoId!)
  })

  // (C) prospecção + org de teste + SEM a env de organização → NÃO comprime.
  it('(C) sem PROSPECCAO_TESTE_ORGANIZACAO_ID, não comprime nem na org de teste', async () => {
    ligarModoTeste(null, '2')
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    await esperaEmDiasReais(store, inscricao.execucaoId!)
  })

  // (D) prospecção + org de teste + SEM a env de intervalo → NÃO comprime.
  it('(D) sem PROSPECCAO_TESTE_INTERVALO_MINUTOS, não comprime nem na org de teste', async () => {
    ligarModoTeste(ORG_TESTE, null)
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteFake()
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
    await processarTudo(store, registro, amb)

    await esperaEmDiasReais(store, inscricao.execucaoId!)
  })

  it('intervalo inválido (zero, negativo ou não numérico) não comprime', async () => {
    for (const invalido of ['0', '-5', 'abc', '']) {
      ligarModoTeste(ORG_TESTE, invalido)
      const { store, wfId } = await publicarDef()
      const amb = new AmbienteFake()
      const inscricao = await inscreverLeadManual(store, wfId, 'lead-1', 'campanha-1')
      await processarTudo(store, registro, amb)

      await esperaEmDiasReais(store, inscricao.execucaoId!)
    }
  })
})
