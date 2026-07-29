// Blocos padrão do motor de workflows (Fase 3) — genéricos, não específicos de
// um caso. Cada um é registrado por `tipo` e resolvido pelo executor via o
// RegistroWorkflows. Adicionar um bloco novo é registrar mais um aqui (ou em
// qualquer lugar), sem tocar no executor.
import type { Acao, Condicao, CtxExec, Gatilho, ResultadoAcao } from './registro'
import { RegistroWorkflows } from './registro'
import type { BlocoConfig } from './types'
import { avaliarOperador, type Operador } from './operadores'

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

// --- CONDIÇÃO genérica: um campo do lead comparado com um valor (Fase 4.5) ----
// config: { campo, operador, valor }. É o "filtro de público genérico": lê o
// campo (whitelist no ambiente) e delega a comparação para avaliarOperador.
export const condicaoCampo: Condicao = {
  tipo: 'campo',
  async avaliar(ctx) {
    if (!ctx.leadId) return false
    const campo = String(ctx.config.campo ?? '')
    if (!campo) return false
    const operador = String(ctx.config.operador ?? 'igual') as Operador
    const atual = await ctx.ambiente.lerCampoLead(ctx.leadId, campo)
    return avaliarOperador(operador, atual, ctx.config.valor)
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

// --- AÇÃO: ramificar — SALTO CONDICIONAL no pipeline (Fase 4.5, entrega 2) ----
// config: { condicao: BlocoConfig, destino: number }. Avalia a condição via o
// registro; se PASSA, salta o pipeline para o passo `destino`; senão continua
// para o próximo passo. É a ramificação DE VERDADE: o braço destino são passos
// de topo, então esperas dentro dele SUSPENDEM normalmente — diferente da versão
// síncrona antiga (rodava sub-ações inline e IGNORAVA esperas), que não cobria
// o caso "aguardar → ramificar pelo resultado → aguardar de novo".
export const acaoRamificar: Acao = {
  tipo: 'ramificar',
  async executar(ctx): Promise<ResultadoAcao> {
    const cond = ctx.config.condicao as BlocoConfig | undefined
    if (!cond?.tipo) throw new Error("ação 'ramificar' exige config.condicao")
    const destino = Number(ctx.config.destino)
    if (!Number.isInteger(destino) || destino < 0)
      throw new Error("ação 'ramificar' exige config.destino (índice de passo inteiro >= 0)")
    const passou = await ctx.registro.obterCondicao(cond.tipo).avaliar(comConfig(ctx, cond.config ?? {}))
    await ctx.log('ramificacao_avaliada', { condicao: cond.tipo, passou, destino })
    return passou ? { tipo: 'saltar', para: destino } : { tipo: 'continuar' }
  },
}

// --- AÇÃO: encerrar — conclui a execução aqui (halt) -------------------------
// Sela um braço numa lista plana: sem ele, o braço que saltou "por cima" cairia
// nos passos do outro braço logo abaixo.
export const acaoEncerrar: Acao = {
  tipo: 'encerrar',
  async executar(): Promise<ResultadoAcao> {
    return { tipo: 'encerrar' }
  },
}

// Registra o conjunto padrão num RegistroWorkflows (novo ou fornecido).
export function registrarBlocosPadrao(registro = new RegistroWorkflows()): RegistroWorkflows {
  return registro
    .registrarGatilho(gatilhoCampoDataVence)
    .registrarCondicao(condicaoLeadRespondeu)
    .registrarCondicao(condicaoCampo)
    .registrarAcao(acaoEsperar)
    .registrarAcao(acaoEnviarEmail)
    .registrarAcao(acaoCriarTarefa)
    .registrarAcao(acaoRamificar)
    .registrarAcao(acaoEncerrar)
}
