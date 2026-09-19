// TESTE PONTA A PONTA — bloco funcional "Prospecção + Follow-up" (itens A-H
// do roteiro da entrega). Usa MemoryWorkflowStore (sem rede/Supabase) para
// provar a ORQUESTRAÇÃO real do executor — esperar persistido, avanço de
// passo, cancelamento — combinada com a MESMA função pura de efeito de envio
// usada em produção (lib/campanhas/prospeccaoEnvio.ts), para que a prova não
// dependa de uma reimplementação paralela da regra de negócio.
//
// A definição do workflow abaixo tem exatamente a FORMA que
// lib/campanhas/configuracaoGuiada.ts::montarDefinicaoCampanha gera para uma
// campanha de prospecção com 1ª mensagem + 2 follow-ups (dia 0, dia 3, dia 7):
// enviar_email direto (sem espera antes do 1º), depois esperar/enviar_email
// alternados. A integração real com Supabase (estágio, tipo de interação,
// gate de bloqueio) é coberta por prospeccaoEnvioAmbiente.test.ts; este
// arquivo prova o fluxo completo de ponta a ponta.
import { describe, expect, it } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { criarWorkflow, publicar } from '../versionamento'
import { registrarBlocosPadrao } from '../blocos'
import { processarTudo, inscreverLeadManual } from '../executor'
import type { AmbienteWorkflow } from '../ambiente'
import type { DefinicaoWorkflow } from '../types'
import { efeitoEnvioProspeccao, leadBloqueadoParaEnvioProspeccao } from '@/lib/campanhas/prospeccaoEnvio'

interface LeadSimulado {
  estagio: string
  followupsEnviados: number
  optout: boolean
  bounced: boolean
  perdido: boolean
}

class AmbienteProspeccaoFake implements AmbienteWorkflow {
  organizacaoId = 'org-teste'
  simular = false
  leads = new Map<string, LeadSimulado>()
  emails: { leadId: string; template: string }[] = []

  criarLead(id: string, overrides: Partial<LeadSimulado> = {}) {
    this.leads.set(id, { estagio: 'novos_leads', followupsEnviados: 0, optout: false, bounced: false, perdido: false, ...overrides })
  }

  async buscarControleExecucaoCampanha() {
    return { status: 'ativa' as const, diasSemana: null, disparoUnico: false }
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

  // Mesma decisão de negócio de AmbienteSupabase.enviarEmailTemplate quando
  // campanhaTipo==='prospeccao' (função pura importada de produção, não
  // reimplementada aqui).
  async enviarEmailTemplate(leadId: string, template: string) {
    const lead = this.leads.get(leadId)
    if (leadBloqueadoParaEnvioProspeccao(lead ? {
      optout: lead.optout, bounced: lead.bounced, perdido: lead.perdido, estagio: lead.estagio,
    } : null)) {
      return { enviado: false, assunto: 'bloqueado' }
    }
    this.emails.push({ leadId, template })
    const efeito = efeitoEnvioProspeccao(lead!.estagio, lead!.followupsEnviados)
    this.leads.set(leadId, { ...lead!, estagio: efeito.estagioDestino, followupsEnviados: efeito.followupsEnviados })
    return { enviado: true, assunto: template }
  }
}

// Forma real de montarDefinicaoCampanha para 1ª mensagem (dia 0) + follow-up
// em dia 3 + follow-up em dia 7.
const DEF_PROSPECCAO: DefinicaoWorkflow = {
  gatilho: { id: 'gatilho-manual', tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'email-0', tipo: 'enviar_email', config: { template: 'abordagem_1' } },
    { id: 'espera-1', tipo: 'esperar', config: { dias: 3, horas: 0 } },
    { id: 'email-1', tipo: 'enviar_email', config: { template: 'follow_up_1' } },
    { id: 'espera-2', tipo: 'esperar', config: { dias: 4, horas: 0 } },
    { id: 'email-2', tipo: 'enviar_email', config: { template: 'follow_up_2' } },
  ],
}

const registro = registrarBlocosPadrao()

async function publicarDef() {
  const store = new MemoryWorkflowStore()
  const wf = await criarWorkflow(store, { nome: 'Prospecção E2E', definicao: DEF_PROSPECCAO })
  await publicar(store, wf.id)
  return { store, wfId: wf.id }
}

describe('E2E — Prospecção + Follow-up (itens A-H)', () => {
  it('A+B+C: lead novos_leads recebe 1º contato uma única vez e muda para primeiro_contato', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')

    await inscreverLeadManual(store, wfId, 'lead-1') // simula a auto-captura (item A)
    await processarTudo(store, registro, amb)

    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'abordagem_1' }]) // B: uma única vez
    expect(amb.leads.get('lead-1')?.estagio).toBe('primeiro_contato') // C
  })

  it('D: antes do prazo (3 dias), nenhum follow-up é enviado', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')
    await inscreverLeadManual(store, wfId, 'lead-1')
    await processarTudo(store, registro, amb) // envia o 1º contato, entra em espera

    const antesDoVencimento = new Date(Date.now() + 2 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, antesDoVencimento)

    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'abordagem_1' }]) // nada além do 1º contato
  })

  it('E: prazo vencido sem resposta -> follow-up enviado uma única vez', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')
    await inscreverLeadManual(store, wfId, 'lead-1')
    await processarTudo(store, registro, amb)

    const apos3Dias = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, apos3Dias)
    // reprocessar o MESMO tick não duplica o follow-up já enviado.
    await processarTudo(store, registro, amb, apos3Dias)

    expect(amb.emails).toEqual([
      { leadId: 'lead-1', template: 'abordagem_1' },
      { leadId: 'lead-1', template: 'follow_up_1' },
    ])
    expect(amb.leads.get('lead-1')?.estagio).toBe('follow_up')
    expect(amb.leads.get('lead-1')?.followupsEnviados).toBe(1)
  })

  it('F: resposta antes do próximo follow-up cancela o restante da cadência', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')
    const inscricao = await inscreverLeadManual(store, wfId, 'lead-1')
    await processarTudo(store, registro, amb) // 1º contato enviado, aguardando o follow-up 1

    // Simula o que lib/engine/flows/detectarResposta.ts faz ao detectar uma
    // resposta humana: cancela a execução ativa do lead (aqui, diretamente no
    // WorkflowStore — a chamada real passa por SupabaseStore.cancelarExecucoesWorkflow).
    await store.atualizarExecucao(inscricao.execucaoId!, { status: 'cancelado' })

    const bemDepois = new Date(Date.now() + 30 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, bemDepois)

    // Nenhum follow-up saiu depois do cancelamento.
    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'abordagem_1' }])
    const pendentes = await store.execucoesPendentes(bemDepois)
    expect(pendentes).toHaveLength(0)
  })

  it('G: opt-out durante a cadência impede novos envios (nenhum follow-up sai)', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')
    await inscreverLeadManual(store, wfId, 'lead-1')
    await processarTudo(store, registro, amb) // 1º contato

    // Opt-out acontece DEPOIS do 1º contato, antes do follow-up vencer.
    amb.leads.set('lead-1', { ...amb.leads.get('lead-1')!, optout: true })

    const t1 = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t1)
    const t2 = new Date(Date.now() + 10 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t2)

    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'abordagem_1' }]) // só o 1º contato
  })

  it('H: reinscrever o mesmo lead no mesmo workflow não cria execução duplicada', async () => {
    const { store, wfId } = await publicarDef()
    const primeira = await inscreverLeadManual(store, wfId, 'lead-1')
    const segunda = await inscreverLeadManual(store, wfId, 'lead-1')

    expect(primeira.jaInscrito).toBe(false)
    expect(segunda.jaInscrito).toBe(true)
    expect(segunda.execucaoId).toBe(primeira.execucaoId)
  })

  it('H: reprocessar o cron no mesmo lote não duplica envio nem inscrição', async () => {
    const { store, wfId } = await publicarDef()
    const amb = new AmbienteProspeccaoFake()
    amb.criarLead('lead-1')
    await inscreverLeadManual(store, wfId, 'lead-1')

    // Dois ticks "simultâneos" do cron no mesmo instante.
    await processarTudo(store, registro, amb)
    await processarTudo(store, registro, amb)

    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'abordagem_1' }])
  })
})
