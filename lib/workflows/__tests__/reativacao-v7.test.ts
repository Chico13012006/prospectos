// Item B — verificação precoce de lead_respondeu antes do primeiro esperar.
// Valida que a nova v7 do workflow BaseLaudos não manda follow-up para leads
// que já responderam logo após T1.
import { describe, it, expect } from 'vitest'
import { MemoryWorkflowStore } from '../store/memoryStore'
import { criarWorkflow, publicar } from '../versionamento'
import { registrarBlocosPadrao } from '../blocos'
import { processarTudo, inscreverLeadManual } from '../executor'
import type { AmbienteWorkflow } from '../ambiente'
import type { DefinicaoWorkflow } from '../types'
import { avaliarOperador, type Operador } from '../operadores'

class AmbienteFake implements AmbienteWorkflow {
  organizacaoId = 'org-test'
  simular = false
  async buscarControleExecucaoCampanha() {
    return { status: 'ativa', diasSemana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'], disparoUnico: false }
  }
  async sincronizarConclusaoCampanha() {}
  alvos: string[] = []
  respondeu = new Set<string>()
  emails: { leadId: string; template: string }[] = []
  tarefas: { leadId: string; titulo: string; responsavelId?: string | null }[] = []
  campos: Record<string, Record<string, unknown>> = {}
  escritas: { leadId: string; campo: string; valor: unknown }[] = []
  async selecionarLeadsComCampoVencendo() { return this.alvos }
  async selecionarLeadsPorCampo(campo: string, operador: string, valor: unknown) {
    return Object.entries(this.campos)
      .filter(([, c]) => avaliarOperador(operador as Operador, c[campo], valor))
      .map(([id]) => id)
  }
  async selecionarLeadsSemRespostaHaDias(campo: string, dias: number) {
    const limite = Date.now() - dias * 86_400_000
    return Object.entries(this.campos)
      .filter(([id, c]) => { const t = Date.parse(String(c[campo])); return !Number.isNaN(t) && t <= limite && !this.respondeu.has(id) })
      .map(([id]) => id)
  }
  async leadRespondeu(leadId: string) { return this.respondeu.has(leadId) }
  async lerCampoLead(leadId: string, campo: string) { return this.campos[leadId]?.[campo] ?? null }
  async enviarEmailTemplate(leadId: string, template: string) { this.emails.push({ leadId, template }); return { enviado: true, assunto: 'assunto' } }
  async criarTarefa(leadId: string, titulo: string, responsavelId?: string | null) { this.tarefas.push({ leadId, titulo, responsavelId }) }
  oportunidades: { leadId: string; titulo?: string; valor?: number | null }[] = []
  async criarOportunidade(leadId: string, dados: { titulo?: string; valor?: number | null }) { this.oportunidades.push({ leadId, ...dados }) }
  async atualizarCampoLead(leadId: string, campo: string, valor: unknown) { this.escritas.push({ leadId, campo, valor }) }
  async inscreverEmCampanha(_leadId: string, _campanhaId: string) { /* stub */ }
  async selecionarLeadsQueResponderamRecente(_dias: number) { return this.alvos }
  async selecionarLeadsSemRespostaInbound(_dias: number) { return this.alvos }
  async selecionarLeadsPorEstagio(_estagio: string) { return this.alvos }
  async selecionarLeadsComValidadeVencida(_diasApos: number) { return this.alvos }
}

// Definição v7: a1b inserido entre a1 e a2 — salto precoce se lead já respondeu.
const DEF_V7: DefinicaoWorkflow = {
  gatilho: { tipo: 'manual', config: {} },
  condicoes: [],
  acoes: [
    { id: 'a1',  tipo: 'enviar_email', config: { template: 'reativacao_1' } },
    { id: 'a1b', tipo: 'saltar_se', config: { destino: 'a11', condicao: { tipo: 'lead_respondeu', config: { respondeu: true } } } },
    { id: 'a2',  tipo: 'esperar', config: { dias: 2 } },
    { id: 'a3',  tipo: 'enviar_email', config: { template: 'reativacao_2' } },
    { id: 'a4',  tipo: 'esperar', config: { dias: 2 } },
    { id: 'a5',  tipo: 'ramificar', config: { condicao: { tipo: 'campo', config: { campo: 'data_validade', operador: 'nao_vazio' } }, entao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3' } }], senao: [{ tipo: 'enviar_email', config: { template: 'reativacao_3b' } }] } },
    { id: 'a6',  tipo: 'esperar', config: { dias: 3 } },
    { id: 'a7',  tipo: 'enviar_email', config: { template: 'reativacao_4' } },
    { id: 'a8',  tipo: 'esperar', config: { dias: 2 } },
    { id: 'a9',  tipo: 'saltar_se', config: { destino: 'a11', condicao: { tipo: 'lead_respondeu', config: { respondeu: true } } } },
    { id: 'a10', tipo: 'enviar_email', config: { template: 'reativacao_5' } },
    { id: 'a10b', tipo: 'esperar', config: { dias: 90 } },
    { id: 'a10c', tipo: 'enviar_email', config: { template: 'reativacao_6' } },
    { id: 'fim',  tipo: 'encerrar', config: {} },
    { id: 'a11', tipo: 'criar_tarefa', config: { titulo: 'Resposta recebida — retomar conversa com {empresa}' } },
    { id: 'fim2', tipo: 'encerrar', config: {} },
  ],
}

const registro = registrarBlocosPadrao()

async function publicarDef(def: DefinicaoWorkflow) {
  const store = new MemoryWorkflowStore()
  const wf = await criarWorkflow(store, { nome: 'Reativação v7', definicao: def })
  await publicar(store, wf.id)
  return { store, wfId: wf.id }
}

describe('workflow BaseLaudos v7 — salto precoce por lead_respondeu', () => {
  it('lead que JÁ respondeu salta para a11 imediatamente após T1 (não entra na espera)', async () => {
    const { store, wfId } = await publicarDef(DEF_V7)
    const amb = new AmbienteFake()
    amb.respondeu.add('lead-1')
    await inscreverLeadManual(store, wfId, 'lead-1')

    await processarTudo(store, registro, amb)

    expect(amb.emails.map((e) => e.template)).toEqual(['reativacao_1'])
    expect(amb.tarefas.some((t) => t.titulo.includes('Resposta recebida'))).toBe(true)
    // execução concluída (não em espera)
    const pendentes = await store.execucoesPendentes(new Date().toISOString())
    expect(pendentes).toHaveLength(0)
  })

  it('lead que NÃO respondeu passa por a1b e entra na espera de 2 dias (sem tarefa de resposta)', async () => {
    const { store, wfId } = await publicarDef(DEF_V7)
    const amb = new AmbienteFake()
    await inscreverLeadManual(store, wfId, 'lead-1')

    await processarTudo(store, registro, amb)

    expect(amb.emails.map((e) => e.template)).toEqual(['reativacao_1'])
    expect(amb.tarefas).toHaveLength(0)
    // aguardando — não venceu ainda
    const pendentesAgora = await store.execucoesPendentes(new Date().toISOString())
    expect(pendentesAgora).toHaveLength(0)
    // vence em 3 dias
    const futuro = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const pendentes3d = await store.execucoesPendentes(futuro)
    expect(pendentes3d).toHaveLength(1)
  })

  it('lead que responde DURANTE a espera: a9 captura e salta para a11 (sem reativacao_5)', async () => {
    const { store, wfId } = await publicarDef(DEF_V7)
    const amb = new AmbienteFake()
    await inscreverLeadManual(store, wfId, 'lead-1')

    // Tick 1: T1 enviado, para em a2 (esperar 2d)
    await processarTudo(store, registro, amb)
    expect(amb.emails.map((e) => e.template)).toEqual(['reativacao_1'])

    // responde durante a espera
    amb.respondeu.add('lead-1')

    // Ticks seguintes: avança por a2(retoma)→a3(T2)→a4(esperar)→a5(ramif)→a6(esp)→a7→a8(esp)→a9(saltar!)→a11
    const t1 = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t1)
    const t2 = new Date(Date.now() + 5 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t2)
    const t3 = new Date(Date.now() + 9 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t3)
    const t4 = new Date(Date.now() + 12 * 86_400_000).toISOString()
    await processarTudo(store, registro, amb, t4)

    // reativacao_5 NÃO deve ter sido enviado (a9 saltou)
    const templates = amb.emails.map((e) => e.template)
    expect(templates).not.toContain('reativacao_5')
    expect(amb.tarefas.some((t) => t.titulo.includes('Resposta recebida'))).toBe(true)
  })
})
