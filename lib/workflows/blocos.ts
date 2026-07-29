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

// === AÇÕES EXPANDIDAS (Fase 4.5, entrega 3) — aditivas, mesmo padrão ==========

// --- AÇÃO: enviar_whatsapp — STUB (sem integração real ainda) ----------------
// Não envia: loga a INTENÇÃO e marca a execução como pendente de integração. O
// provedor (tendência: Meta Cloud API) é decisão de negócio pendente — este stub
// não bloqueia o resto. config: { texto } (mensagem/label livre).
export const acaoEnviarWhatsapp: Acao = {
  tipo: 'enviar_whatsapp',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'enviar_whatsapp' exige um lead")
    const texto = String(ctx.config.texto ?? '')
    await ctx.log('whatsapp_pendente', { pendente_integracao: true, texto })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: criar_tarefa_ligacao — tarefa de ligação --------------------------
export const acaoCriarTarefaLigacao: Acao = {
  tipo: 'criar_tarefa_ligacao',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'criar_tarefa_ligacao' exige um lead")
    const titulo = String(ctx.config.titulo ?? 'Ligar para o lead')
    await ctx.ambiente.criarTarefa(ctx.leadId, `[Ligação] ${titulo}`)
    await ctx.log('tarefa_ligacao_criada', { titulo })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: atualizar_status — muda o estágio/status do lead ------------------
// No schema real de `leads` o "status" é a coluna `estagio` (não há status
// separado); mover_pipeline usa a MESMA coluna. Ambas existem por pedido do spec.
export const acaoAtualizarStatus: Acao = {
  tipo: 'atualizar_status',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'atualizar_status' exige um lead")
    const estagio = String(ctx.config.estagio ?? '')
    if (!estagio) throw new Error("ação 'atualizar_status' exige config.estagio")
    await ctx.ambiente.atualizarCampoLead(ctx.leadId, 'estagio', estagio)
    await ctx.log('status_atualizado', { estagio })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: mover_pipeline — move a etapa do pipeline (leads.estagio) ---------
export const acaoMoverPipeline: Acao = {
  tipo: 'mover_pipeline',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'mover_pipeline' exige um lead")
    const estagio = String(ctx.config.estagio ?? '')
    if (!estagio) throw new Error("ação 'mover_pipeline' exige config.estagio")
    await ctx.ambiente.atualizarCampoLead(ctx.leadId, 'estagio', estagio)
    await ctx.log('pipeline_movido', { estagio })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: atribuir_responsavel — define o responsável do lead ---------------
export const acaoAtribuirResponsavel: Acao = {
  tipo: 'atribuir_responsavel',
  async executar(ctx): Promise<ResultadoAcao> {
    if (!ctx.leadId) throw new Error("ação 'atribuir_responsavel' exige um lead")
    const responsavelId = String(ctx.config.responsavel_id ?? '')
    if (!responsavelId) throw new Error("ação 'atribuir_responsavel' exige config.responsavel_id")
    await ctx.ambiente.atualizarCampoLead(ctx.leadId, 'responsavel_id', responsavelId)
    await ctx.log('responsavel_atribuido', { responsavel_id: responsavelId })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: notificar — avisa o responsável interno (e-mail e/ou WhatsApp) -----
// Nesta v1 é uma NOTIFICAÇÃO logada (reaproveita o mesmo stub do WhatsApp): o
// disparo real por canal fica para quando a integração existir. config:
// { canais: 'email'|'whatsapp'|'ambos', mensagem }.
export const acaoNotificar: Acao = {
  tipo: 'notificar',
  async executar(ctx): Promise<ResultadoAcao> {
    const canais = String(ctx.config.canais ?? 'email')
    const mensagem = String(ctx.config.mensagem ?? '')
    await ctx.log('responsavel_notificado', { canais, mensagem, pendente_integracao: canais !== 'email' })
    return { tipo: 'continuar' }
  },
}

// --- AÇÃO: ramificar (SÍNCRONO, legado) — A ou B por uma condição ------------
// config: { condicao: BlocoConfig, entao: BlocoConfig[], senao: BlocoConfig[] }.
// Avalia a condição e roda as ações do ramo escolhido, em sequência. As esperas
// dentro de um ramo NÃO suspendem (só logam e são ignoradas). PRESERVADO INTACTO
// por imutabilidade de versão: versões publicadas na Fase 3 podem ter congelado
// este tipo com ESTE formato de config. Para o caso "aguardar → ramificar →
// aguardar", use `saltar_se` (salto no pipeline), abaixo.
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

// --- AÇÃO: saltar_se — SALTO CONDICIONAL no pipeline (Fase 4.5, entrega 2) ----
// config: { condicao: BlocoConfig, destino: number }. Avalia a condição via o
// registro; se PASSA, salta o pipeline para o passo `destino`; senão continua
// para o próximo passo. É a ramificação DE VERDADE: o braço destino são passos
// de TOPO, então esperas dentro dele SUSPENDEM normalmente. Tipo NOVO (não
// reaproveita 'ramificar', cujo formato de config é outro) — protege a
// imutabilidade das versões já publicadas.
export const acaoSaltarSe: Acao = {
  tipo: 'saltar_se',
  async executar(ctx): Promise<ResultadoAcao> {
    const cond = ctx.config.condicao as BlocoConfig | undefined
    if (!cond?.tipo) throw new Error("ação 'saltar_se' exige config.condicao")
    const destino = Number(ctx.config.destino)
    if (!Number.isInteger(destino) || destino < 0)
      throw new Error("ação 'saltar_se' exige config.destino (índice de passo inteiro >= 0)")
    const passou = await ctx.registro.obterCondicao(cond.tipo).avaliar(comConfig(ctx, cond.config ?? {}))
    await ctx.log('salto_avaliado', { condicao: cond.tipo, passou, destino })
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
    .registrarAcao(acaoEnviarWhatsapp)
    .registrarAcao(acaoCriarTarefaLigacao)
    .registrarAcao(acaoAtualizarStatus)
    .registrarAcao(acaoMoverPipeline)
    .registrarAcao(acaoAtribuirResponsavel)
    .registrarAcao(acaoNotificar)
    .registrarAcao(acaoRamificar)
    .registrarAcao(acaoSaltarSe)
    .registrarAcao(acaoEncerrar)
}
