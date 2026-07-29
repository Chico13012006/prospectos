// Blocos padrão do motor de workflows (Fase 3) — genéricos, não específicos de
// um caso. Cada um é registrado por `tipo` e resolvido pelo executor via o
// RegistroWorkflows. Adicionar um bloco novo é registrar mais um aqui (ou em
// qualquer lugar), sem tocar no executor.
import type { Acao, Condicao, CtxExec, Gatilho, ResultadoAcao } from './registro'
import { RegistroWorkflows } from './registro'
import type { BlocoConfig } from './types'

// Helper: mesmo contexto, outro `config` (para blocos aninhados em 'ramificar').
const comConfig = (ctx: CtxExec, config: Record<string, unknown>): CtxExec => ({ ...ctx, config })

const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao)

// --- GATILHO: campo de data do lead vence em até N dias ---------------------
export const gatilhoCampoDataVence: Gatilho = {
  tipo: 'campo_data_vence',
  async selecionarAlvos(ctx) {
    const campo = String(ctx.config.campo ?? 'proxima_acao_data')
    const dias = num(ctx.config.dias, 0)
    return ctx.ambiente.selecionarLeadsComCampoVencendo(campo, dias)
  },
}

// --- CONDIÇÃO: o lead respondeu? (reaproveita o sinal do detectarResposta) ---
// config.respondeu (default true): a condição PASSA quando o estado do lead bate
// com o esperado. Ex.: { respondeu: false } passa só se o lead NÃO respondeu.
export const condicaoLeadRespondeu: Condicao = {
  tipo: 'lead_respondeu',
  async avaliar(ctx) {
    if (!ctx.leadId) return false
    const esperado = ctx.config.respondeu !== false // default: espera que TENHA respondido
    const respondeu = await ctx.ambiente.leadRespondeu(ctx.leadId)
    return respondeu === esperado
  },
}

// --- AÇÃO: esperar N dias/horas (espera PERSISTIDA — suspende a execução) ----
export const acaoEsperar: Acao = {
  tipo: 'esperar',
  async executar(ctx): Promise<ResultadoAcao> {
    const dias = num(ctx.config.dias, 0)
    const horas = num(ctx.config.horas, 0)
    const ms = dias * 86_400_000 + horas * 3_600_000
    const ate = new Date(Date.now() + ms).toISOString()
    return { tipo: 'esperar', ate }
  },
}

// --- AÇÃO: enviar mensagem por template (reaproveita mensagem.ts do motor) ---
export const acaoEnviarEmail: Acao = {
  tipo: 'enviar_email',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'enviar_email' exige um lead")
    const template = String(ctx.config.template ?? ctx.config.tipo ?? 'follow_up_1')
    const r = await ctx.ambiente.enviarEmailTemplate(ctx.leadId, template)
    await ctx.log('email_enviado', { template, assunto: r.assunto, enviado: r.enviado })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: criar tarefa -----------------------------------------------------
export const acaoCriarTarefa: Acao = {
  tipo: 'criar_tarefa',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'criar_tarefa' exige um lead")
    const titulo = String(ctx.config.titulo ?? 'Tarefa do workflow')
    await ctx.ambiente.criarTarefa(ctx.leadId, titulo)
    await ctx.log('tarefa_criada', { titulo })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: ramificar (A ou B por uma condição) ------------------------------
// config: { condicao: BlocoConfig, entao: BlocoConfig[], senao: BlocoConfig[] }.
// Avalia a condição e roda as ações do ramo escolhido, em sequência. Nesta v1 as
// esperas dentro de um ramo NÃO suspendem (waits só no nível de topo do pipeline);
// se um sub-bloco pedir espera, ela é ignorada e logada.
export const acaoRamificar: Acao = {
  tipo: 'ramificar',
  async executar(ctx): Promise<ResultadoAcao> {
    const cond = ctx.config.condicao as BlocoConfig | undefined
    if (!cond?.tipo) throw new Error("ação 'ramificar' exige config.condicao")
    const passou = await ctx.registro.obterCondicao(cond.tipo).avaliar(comConfig(ctx, cond.config ?? {}))
    const ramo = (passou ? ctx.config.entao : ctx.config.senao) as BlocoConfig[] | undefined
    await ctx.log('ramo_escolhido', { condicao: cond.tipo, passou, ramo: passou ? 'entao' : 'senao' })
    for (const bloco of ramo ?? []) {
      const res = await ctx.registro.obterAcao(bloco.tipo).executar(comConfig(ctx, bloco.config ?? {}))
      if (res.tipo === 'esperar') await ctx.log('espera_em_ramo_ignorada', { bloco: bloco.tipo })
    }
    return { tipo: 'continuar' }
  },
}

// Registra o conjunto padrão num RegistroWorkflows (novo ou fornecido).
export function registrarBlocosPadrao(registro = new RegistroWorkflows()): RegistroWorkflows {
  return registro
    .registrarGatilho(gatilhoCampoDataVence)
    .registrarCondicao(condicaoLeadRespondeu)
    .registrarAcao(acaoEsperar)
    .registrarAcao(acaoEnviarEmail)
    .registrarAcao(acaoCriarTarefa)
    .registrarAcao(acaoRamificar)
}
