// Motor de execução (Fase 3) — testado com MemoryStore + ambiente falso, sem
// rede. Cobre os critérios de aceite: enrollment idempotente, gate de condições,
// espera PERSISTIDA que sobrevive a "reinício" (o estado vive no store, não em
// fila de memória), branch A/B e idempotência (ação não roda duas vezes).
import { describe, it, expect } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { criarWorkflow, publicar } from '../versionamento'
import { registrarBlocosPadrao } from '../blocos'
import { processarTudo, processarEnrollment, processarExecucao } from '../executor'
import type { AmbienteWorkflow } from '../ambiente'
import type { DefinicaoWorkflow } from '../types'

class AmbienteFake implements AmbienteWorkflow {
  organizacaoId = 'org-test'
  simular = false
  alvos: string[] = []
  respondeu = new Set<string>()
  emails: { leadId: string; template: string }[] = []
  tarefas: { leadId: string; titulo: string }[] = []
  campos: Record<string, Record<string, unknown>> = {} // leadId -> { campo: valor }
  escritas: { leadId: string; campo: string; valor: unknown }[] = []
  async selecionarLeadsComCampoVencendo() { return this.alvos }
  async leadRespondeu(leadId: string) { return this.respondeu.has(leadId) }
  async lerCampoLead(leadId: string, campo: string) { return this.campos[leadId]?.[campo] ?? null }
  async enviarEmailTemplate(leadId: string, template: string) { this.emails.push({ leadId, template }); return { enviado: true, assunto: 'assunto' } }
  async criarTarefa(leadId: string, titulo: string) { this.tarefas.push({ leadId, titulo }) }
  async atualizarCampoLead(leadId: string, campo: string, valor: unknown) { this.escritas.push({ leadId, campo, valor }) }
}

const registro = registrarBlocosPadrao()

async function publicarWorkflow(store: MemoryWorkflowStore, def: DefinicaoWorkflow) {
  const wf = await criarWorkflow(store, { nome: 'W', definicao: def })
  await publicar(store, wf.id)
  return wf.id
}

const gatilho = { tipo: 'campo_data_vence', config: { campo: 'proxima_acao_data', dias: 3 } }

describe('executor de workflows', () => {
  it('enrollment inscreve os alvos do gatilho e é idempotente', async () => {
    const store = new MemoryWorkflowStore()
    const amb = new AmbienteFake()
    amb.alvos = ['lead-1', 'lead-2']
    const wfId = await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [{ tipo: 'criar_tarefa', config: { titulo: 'x' } }] })

    expect(await processarEnrollment(store, registro, amb)).toBe(2)
    expect(await processarEnrollment(store, registro, amb)).toBe(0) // não reinscreve
    expect(await store.existeExecucaoParaLead(wfId, 'lead-1')).toBe(true)
  })

  it('gate de condição barra o pipeline (concluído sem ação)', async () => {
    const store = new MemoryWorkflowStore()
    const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    amb.respondeu.add('lead-1') // já respondeu
    // condição: só segue se NÃO respondeu → deve barrar
    await publicarWorkflow(store, {
      gatilho,
      condicoes: [{ tipo: 'lead_respondeu', config: { respondeu: false } }],
      acoes: [{ tipo: 'enviar_email', config: { template: 'follow_up_1' } }],
    })

    await processarTudo(store, registro, amb)
    expect(amb.emails).toHaveLength(0)
    const [ex] = await store.execucoesPendentes(new Date(Date.now() + 9e11).toISOString())
    expect(ex).toBeUndefined() // nada pendente: execução foi concluída
  })

  it('condição genérica de campo gateia pelo valor real do lead', async () => {
    // segue só se estagio === 'follow_up_1'. lead-1 casa; lead-2 não.
    const def: DefinicaoWorkflow = {
      gatilho,
      condicoes: [{ tipo: 'campo', config: { campo: 'estagio', operador: 'igual', valor: 'follow_up_1' } }],
      acoes: [{ tipo: 'criar_tarefa', config: { titulo: 't' } }],
    }
    const sA = new MemoryWorkflowStore(); const aA = new AmbienteFake()
    aA.alvos = ['lead-1']; aA.campos = { 'lead-1': { estagio: 'follow_up_1' } }
    await publicarWorkflow(sA, def)
    await processarTudo(sA, registro, aA)
    expect(aA.tarefas).toHaveLength(1)

    const sB = new MemoryWorkflowStore(); const aB = new AmbienteFake()
    aB.alvos = ['lead-2']; aB.campos = { 'lead-2': { estagio: 'ganho' } }
    await publicarWorkflow(sB, def)
    await processarTudo(sB, registro, aB)
    expect(aB.tarefas).toHaveLength(0)
  })

  it('espera PERSISTIDA suspende e retoma no mesmo passo após "reinício"', async () => {
    const store = new MemoryWorkflowStore()
    const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    await publicarWorkflow(store, {
      gatilho,
      condicoes: [],
      acoes: [
        { tipo: 'esperar', config: { dias: 3 } },
        { tipo: 'enviar_email', config: { template: 'follow_up_1' } },
      ],
    })

    // Tick 1 (agora): inscreve, roda até a espera. E-mail ainda NÃO saiu.
    const r1 = await processarTudo(store, registro, amb)
    expect(r1.inscritos).toBe(1)
    expect(amb.emails).toHaveLength(0)
    const pendentesAgora = await store.execucoesPendentes(new Date().toISOString())
    expect(pendentesAgora).toHaveLength(0) // está 'aguardando', não vencida

    // "Reinício": nenhum estado em memória — só o que está no store. Tick 2 no
    // futuro (após a espera vencer) retoma e envia.
    const futuro = new Date(Date.now() + 4 * 86_400_000).toISOString()
    const r2 = await processarTudo(store, registro, amb, futuro)
    expect(r2.processadas).toBe(1)
    expect(amb.emails).toEqual([{ leadId: 'lead-1', template: 'follow_up_1' }])
  })

  it('ramificar (síncrono, legado): roda o ramo entao/senao inline conforme a condição', async () => {
    const def: DefinicaoWorkflow = {
      gatilho,
      condicoes: [],
      acoes: [{
        tipo: 'ramificar',
        config: {
          condicao: { tipo: 'lead_respondeu', config: { respondeu: true } },
          entao: [{ tipo: 'criar_tarefa', config: { titulo: 'Ligar (respondeu)' } }],
          senao: [{ tipo: 'enviar_email', config: { template: 'follow_up_1' } }],
        },
      }],
    }
    const sA = new MemoryWorkflowStore(); const aA = new AmbienteFake()
    aA.alvos = ['lead-1']; aA.respondeu.add('lead-1')
    await publicarWorkflow(sA, def)
    await processarTudo(sA, registro, aA)
    expect(aA.tarefas).toHaveLength(1)
    expect(aA.emails).toHaveLength(0)

    const sB = new MemoryWorkflowStore(); const aB = new AmbienteFake()
    aB.alvos = ['lead-2']
    await publicarWorkflow(sB, def)
    await processarTudo(sB, registro, aB)
    expect(aB.emails).toHaveLength(1)
    expect(aB.tarefas).toHaveLength(0)
  })

  // Fluxo de aceite da Fase 4.5 (control-flow por SALTO no pipeline; as ações
  // finais 'atualizar status'/'notificar' chegam na entrega 3 — aqui uso as
  // ações disponíveis como stand-in, o que prova é o desvio de passo_atual):
  //  0 email(primeiro) · 1 esperar · 2 saltar_se(respondeu→final) · 3 email(follow)
  //  4 esperar · 5 saltar_se(respondeu→final) · 6 tarefa(ligação) · 7 encerrar
  //  8 tarefa(respondeu)  ← destino referenciado por ID estável, não índice
  const ID_FINAL = 'passo-respondeu'
  const fluxoAceite: DefinicaoWorkflow = {
    gatilho,
    condicoes: [],
    acoes: [
      { tipo: 'enviar_email', config: { template: 'primeiro_contato' } },
      { tipo: 'esperar', config: { dias: 3 } },
      { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: ID_FINAL } },
      { tipo: 'enviar_email', config: { template: 'follow_up_1' } },
      { tipo: 'esperar', config: { dias: 3 } },
      { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: ID_FINAL } },
      { tipo: 'criar_tarefa', config: { titulo: 'Ligar (sem resposta)' } },
      { tipo: 'encerrar', config: {} },
      { id: ID_FINAL, tipo: 'criar_tarefa', config: { titulo: 'Respondeu: atualizar status + notificar' } },
    ],
  }

  it('braço "sem resposta" atravessa 2 esperas (persistidas) e encerra sem vazar pro outro braço', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1'] // nunca responde
    await publicarWorkflow(store, fluxoAceite)

    const t0 = new Date().toISOString()
    await processarTudo(store, registro, amb, t0)
    expect(amb.emails.map((e) => e.template)).toEqual(['primeiro_contato']) // parou na 1ª espera
    expect(await store.execucoesPendentes(t0)).toHaveLength(0) // aguardando, não vencida

    // "reinício" + 4 dias: ramifica (não respondeu → continua), manda follow-up, para na 2ª espera.
    const t1 = new Date(Date.now() + 4 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t1)
    expect(amb.emails.map((e) => e.template)).toEqual(['primeiro_contato', 'follow_up_1'])

    // +8 dias: ramifica de novo (não respondeu → continua), cria tarefa de ligação e ENCERRA.
    const t2 = new Date(Date.now() + 8 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t2)
    expect(amb.tarefas).toEqual([{ leadId: 'lead-1', titulo: 'Ligar (sem resposta)' }]) // não vazou pro passo 8
  })

  it('responder durante a espera SALTA para o braço "respondeu" (sem follow-up)', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    await publicarWorkflow(store, fluxoAceite)

    await processarTudo(store, registro, amb) // 0 email, 1 espera
    amb.respondeu.add('lead-1') // respondeu durante a espera

    const futuro = new Date(Date.now() + 4 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, futuro) // 2 ramificar → salta p/ 8
    expect(amb.emails.map((e) => e.template)).toEqual(['primeiro_contato']) // NÃO mandou follow-up
    expect(amb.tarefas).toEqual([{ leadId: 'lead-1', titulo: 'Respondeu: atualizar status + notificar' }])
  })

  it('encerrar conclui a execução (halt) — passos abaixo não rodam', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [
      { tipo: 'encerrar', config: {} },
      { tipo: 'criar_tarefa', config: { titulo: 'não deve rodar' } },
    ] })
    await processarTudo(store, registro, amb)
    expect(amb.tarefas).toHaveLength(0)
  })

  it('trava anti-laço: salto para trás sem espera no meio vira erro (não trava o processo)', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1'] // não respondeu → condição {respondeu:false} passa → salta p/ si mesmo
    await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [
      { id: 'loop', tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: false } }, destino: 'loop' } },
    ] })
    await processarTudo(store, registro, amb)
    const ex = [...(store as unknown as { execucoes: Map<string, { status: string }> }).execucoes.values()][0]
    expect(ex.status).toBe('erro')
  })

  it('saltar_se por ID: o alvo é resolvido por id, então REORDENAR passos não quebra o salto', async () => {
    // Alvo tem id fixo; um passo é inserido ANTES dele (deslocaria o índice).
    // Se o destino fosse índice, apontaria pro passo errado; por id, acerta.
    const alvo = { id: 'alvo', tipo: 'criar_tarefa', config: { titulo: 'destino certo' } }
    const def: DefinicaoWorkflow = {
      gatilho, condicoes: [],
      acoes: [
        { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: 'alvo' } },
        { tipo: 'criar_tarefa', config: { titulo: 'inserido antes do alvo' } }, // desloca o índice do alvo p/ 2
        { tipo: 'enviar_email', config: { template: 'follow_up_1' } },
        { tipo: 'encerrar', config: {} },
        alvo,
      ],
    }
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1']; amb.respondeu.add('lead-1') // respondeu → salta p/ 'alvo'
    await publicarWorkflow(store, def)
    await processarTudo(store, registro, amb)
    expect(amb.tarefas).toEqual([{ leadId: 'lead-1', titulo: 'destino certo' }]) // acertou o alvo, não o passo 1
    expect(amb.emails).toHaveLength(0)
  })

  it('saltar_se com destino inexistente vira erro claro', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1']; amb.respondeu.add('lead-1')
    await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [
      { tipo: 'saltar_se', config: { condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: 'nao-existe' } },
    ] })
    await processarTudo(store, registro, amb)
    const ex = [...(store as unknown as { execucoes: Map<string, { status: string }> }).execucoes.values()][0]
    expect(ex.status).toBe('erro')
  })

  it('idempotência: execução concluída não roda a ação de novo', async () => {
    const store = new MemoryWorkflowStore()
    const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [{ tipo: 'enviar_email', config: { template: 'follow_up_1' } }] })
    await processarTudo(store, registro, amb)
    expect(amb.emails).toHaveLength(1)

    // Reprocessar a mesma execução: nada de novo (status concluído).
    const todas = await store.execucoesPendentes(new Date(Date.now() + 9e11).toISOString())
    expect(todas).toHaveLength(0)
    // força reprocesso direto por id — deve sair cedo
    const store2 = store as unknown as { execucoes: Map<string, { id: string }> }
    const algumId = [...store2.execucoes.values()][0].id
    await processarExecucao(store, registro, amb, algumId)
    expect(amb.emails).toHaveLength(1)
  })

  it('ações expandidas (entrega 3): escrevem no lead e logam; whatsapp fica pendente', async () => {
    const store = new MemoryWorkflowStore(); const amb = new AmbienteFake()
    amb.alvos = ['lead-1']
    await publicarWorkflow(store, { gatilho, condicoes: [], acoes: [
      { tipo: 'atualizar_status', config: { estagio: 'respondeu' } },
      { tipo: 'atribuir_responsavel', config: { responsavel_id: 'user-9' } },
      { tipo: 'criar_tarefa_ligacao', config: { titulo: 'Retornar' } },
      { tipo: 'enviar_whatsapp', config: { texto: 'oi' } },
      { tipo: 'notificar', config: { canais: 'email', mensagem: 'lead quente' } },
    ] })
    await processarTudo(store, registro, amb)

    // escritas no lead (status + responsável)
    expect(amb.escritas).toEqual([
      { leadId: 'lead-1', campo: 'estagio', valor: 'respondeu' },
      { leadId: 'lead-1', campo: 'responsavel_id', valor: 'user-9' },
    ])
    expect(amb.tarefas).toEqual([{ leadId: 'lead-1', titulo: '[Ligação] Retornar' }])

    // eventos: whatsapp pendente de integração; notificação registrada
    const [ex] = [...(store as unknown as { execucoes: Map<string, { id: string }> }).execucoes.values()]
    const eventos = await store.listarEventos(ex.id)
    const tipos = eventos.map((e) => e.tipo)
    expect(tipos).toContain('whatsapp_pendente')
    expect(tipos).toContain('responsavel_notificado')
    const wpp = eventos.find((e) => e.tipo === 'whatsapp_pendente')
    expect(wpp?.detalhe?.pendente_integracao).toBe(true)
  })

  it('gatilho/condição/ação desconhecidos: erro claro do registro', () => {
    expect(() => registro.obterAcao('inexistente')).toThrow(/não registrada/)
    expect(() => registro.obterGatilho('inexistente')).toThrow(/não registrado/)
  })
})
