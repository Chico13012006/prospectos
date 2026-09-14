// Serviço dos comandos do grupo comercial (Fase 4): resposta ao check-in.
//
// Ordem de segurança de um callback de grupo:
//   1. grupo → organização: 0 orgs → ignora; N orgs → erro controlado, nada
//      executa (o índice único da 0044 impede que exista, mas o serviço não
//      confia nisso); 1 org → segue. A org NUNCA vem do callback.
//   2. texto sem "#referência" → ignora sem gravar (conversa normal do grupo).
//   3. registra o comando (unique org+messageId): callback reenviado devolve a
//      linha existente — concluído/ignorado nunca executa de novo; recebido/
//      falhou/processando-preso é retomado (todas as etapas são idempotentes).
//   4. claim por compare-and-swap (recebido|falhou → processando): dois
//      workers com o mesmo callback → só um executa.
//   5. código → check-in (comercial_handoff_notificacoes.codigo_ref, único por
//      org) → handoff. Sem check-in, ou handoff não aberto → 'ignorado' com o
//      motivo gravado, nada muda no lead.
//   6. executa:
//      "1" continuar: nada muda no handoff/lead/cursor; só registra que a
//          rodada foi respondida (o comando concluído é o registro).
//      "2" voltar ao follow-up: inicia o follow-up de retorno (inscrição
//          idempotente + lead em 'follow_up' + 1ª mensagem agendada) e SÓ
//          DEPOIS encerra o handoff (encerrado_motivo='retorno_followup').
//          Se cair no meio, o comando fica 'falhou' com o erro e o reprocesso
//          retoma do ponto certo — nunca "handoff encerrado sem cadência".
// Nunca toca round-robin, responsavel_id ou o histórico de handoffs.
import type { HandoffRepository } from '../handoff/repository'
import type { RegistroHandoff } from '../handoff/types'
import type { NotificacaoHandoffRepository } from '../notificacoes/repository'
import type { NotificacaoHandoff } from '../notificacoes/types'
import { iniciarFollowupDeRetorno, type DepsRetornoFollowup } from '../followup/retornoFollowup'
import { interpretarComandoGrupo, type ComandoGrupo } from './comandos'
import type { ComandoGrupoRegistro, ComandoGrupoRepository } from './repository'
import type { EventoGrupo } from './callbackGrupo'

export const TIPO_CHECKIN = 'handoff_checkin' as const
// 'processando' sem atualização há mais de isto é considerado preso (crash).
export const PROCESSANDO_PRESO_MINUTOS = 5
export const RESULTADO_CONTINUAR = 'continuar'
export const RESULTADO_RETORNO_FOLLOWUP = 'retorno_followup'

export interface DepsComandoGrupo {
  comandos: ComandoGrupoRepository
  notificacoes: Pick<NotificacaoHandoffRepository, 'buscarPorCodigo'>
  handoff: Pick<HandoffRepository, 'buscarHandoff' | 'encerrar'>
  retorno: DepsRetornoFollowup
  agora?: () => Date
}

export type ResultadoComandoGrupo =
  | { tipo: 'ignorado'; motivo: 'grupo_nao_configurado' | 'grupo_ambiguo' | 'sem_comando' }
  // Callback já processado antes (mesmo messageId) — nada executa de novo.
  | { tipo: 'duplicado'; comando: ComandoGrupoRegistro }
  | { tipo: 'concorrente'; comando: ComandoGrupoRegistro }
  | { tipo: 'concluido'; comando: ComandoGrupoRegistro; resultado: typeof RESULTADO_CONTINUAR | typeof RESULTADO_RETORNO_FOLLOWUP; handoff: RegistroHandoff }
  // Comando válido por forma, mas sem efeito: gravado com o motivo.
  | { tipo: 'rejeitado'; comando: ComandoGrupoRegistro; motivo: 'comando_invalido' | 'codigo_desconhecido' | 'handoff_nao_aberto' | 'handoff_desconhecido' }
  // Falha recuperável (reprocessável): gravada com o erro.
  | { tipo: 'falhou'; comando: ComandoGrupoRegistro; motivo: string; erro: string }

function presoDesde(agora: Date): string {
  return new Date(agora.getTime() - PROCESSANDO_PRESO_MINUTOS * 60_000).toISOString()
}

/**
 * Processa UM callback de grupo. Seguro para chamar várias vezes com o mesmo
 * messageId (Z-API reenvia): só o primeiro executa.
 */
export async function processarComandoGrupo(deps: DepsComandoGrupo, evento: EventoGrupo): Promise<ResultadoComandoGrupo> {
  const agora = (deps.agora ?? (() => new Date()))()

  const orgs = await deps.comandos.resolverOrganizacoesDoGrupo(evento.grupoId)
  if (orgs.length === 0) return { tipo: 'ignorado', motivo: 'grupo_nao_configurado' }
  if (orgs.length > 1) {
    console.error(JSON.stringify({
      ts: agora.toISOString(), nivel: 'erro', escopo: 'comercial.grupo',
      msg: 'Grupo comercial configurado em mais de uma organização — comando NÃO processado.',
      grupoId: evento.grupoId, organizacoes: orgs.length, providerMessageId: evento.providerMessageId,
    }))
    return { tipo: 'ignorado', motivo: 'grupo_ambiguo' }
  }
  const org = orgs[0]

  const leitura = interpretarComandoGrupo(evento.texto)
  if (leitura.tipo === 'sem_comando') return { tipo: 'ignorado', motivo: 'sem_comando' }

  const { comando: registro, novo } = await deps.comandos.registrar(org, {
    grupoId: evento.grupoId,
    providerMessageId: evento.providerMessageId,
    remetente: evento.remetente,
    remetenteNome: evento.remetenteNome,
    texto: evento.texto,
    codigoRef: leitura.codigo,
    comando: leitura.tipo === 'comando' ? leitura.comando : null,
    recebidoEm: evento.recebidoEm,
  })
  if (!novo && (registro.status === 'concluido' || registro.status === 'ignorado')) {
    return { tipo: 'duplicado', comando: registro }
  }
  return executarComando(deps, org, registro, agora)
}

// Reprocesso (cron diário / rota interna): retoma o que ficou recebido/falhou/preso.
export async function reprocessarComandosGrupo(
  deps: DepsComandoGrupo,
  organizacaoId: string,
  limite = 20,
): Promise<{ processados: number; concluidos: number; falhas: number }> {
  const agora = (deps.agora ?? (() => new Date()))()
  const pendentes = await deps.comandos.listarReprocessaveis(organizacaoId, presoDesde(agora), limite)
  const contagem = { processados: 0, concluidos: 0, falhas: 0 }
  for (const c of pendentes) {
    contagem.processados++
    const r = await executarComando(deps, organizacaoId, c, agora)
    if (r.tipo === 'concluido') contagem.concluidos++
    else if (r.tipo === 'falhou') contagem.falhas++
  }
  return contagem
}

async function executarComando(deps: DepsComandoGrupo, org: string, registro: ComandoGrupoRegistro, agora: Date): Promise<ResultadoComandoGrupo> {
  const venceu = await deps.comandos.reivindicar(org, registro.id, presoDesde(agora))
  if (!venceu) return { tipo: 'concorrente', comando: registro }

  const rejeitar = async (motivo: 'comando_invalido' | 'codigo_desconhecido' | 'handoff_nao_aberto' | 'handoff_desconhecido', refs: { handoffId?: string | null; notificacaoId?: string | null } = {}): Promise<ResultadoComandoGrupo> => {
    await deps.comandos.concluir(org, registro.id, { status: 'ignorado', resultado: motivo, ...refs })
    return { tipo: 'rejeitado', comando: { ...registro, status: 'ignorado', resultado: motivo }, motivo }
  }

  if (!registro.comando || !registro.codigoRef) return rejeitar('comando_invalido')

  const checkin: NotificacaoHandoff | null = await deps.notificacoes.buscarPorCodigo(org, registro.codigoRef)
  if (!checkin || checkin.tipo !== TIPO_CHECKIN) return rejeitar('codigo_desconhecido')

  const handoff = await deps.handoff.buscarHandoff(org, checkin.handoffId)
  if (!handoff) return rejeitar('handoff_desconhecido', { notificacaoId: checkin.id })
  const refs = { handoffId: handoff.id, notificacaoId: checkin.id }
  if (handoff.encerradoEm || handoff.status !== 'em_contato_comercial') return rejeitar('handoff_nao_aberto', refs)

  try {
    if (registro.comando === '1') {
      // Continuar com o comercial: o registro concluído É a resposta da rodada.
      await deps.comandos.concluir(org, registro.id, { status: 'concluido', resultado: RESULTADO_CONTINUAR, ...refs })
      return { tipo: 'concluido', comando: { ...registro, status: 'concluido', resultado: RESULTADO_CONTINUAR, ...refs }, resultado: RESULTADO_CONTINUAR, handoff }
    }
    return await voltarParaFollowup(deps, org, registro, handoff, refs)
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await deps.comandos.falhar(org, registro.id, 'erro_processamento', erro, refs)
    return { tipo: 'falhou', comando: { ...registro, status: 'falhou', erro }, motivo: 'erro_processamento', erro }
  }
}

async function voltarParaFollowup(
  deps: DepsComandoGrupo,
  org: string,
  registro: ComandoGrupoRegistro,
  handoff: RegistroHandoff,
  refs: { handoffId: string; notificacaoId: string },
): Promise<ResultadoComandoGrupo> {
  // 1) follow-up primeiro (idempotente); 2) só então encerra o handoff.
  const retorno = await iniciarFollowupDeRetorno(deps.retorno, org, handoff)
  if (!retorno.ok) {
    // Sem campanha configurada/válida: nada mudou; fica 'falhou' para
    // reprocessar depois que a configuração existir. Handoff segue aberto.
    await deps.comandos.falhar(org, registro.id, retorno.motivo, retorno.detalhe ?? retorno.motivo, refs)
    return { tipo: 'falhou', comando: { ...registro, status: 'falhou', resultado: retorno.motivo, ...refs }, motivo: retorno.motivo, erro: retorno.detalhe ?? retorno.motivo }
  }
  const encerramento = await deps.handoff.encerrar(org, handoff.id, 'retorno_followup')
  if (encerramento === 'nao_encontrado') throw new Error('handoff sumiu antes de encerrar')
  await deps.comandos.concluir(org, registro.id, { status: 'concluido', resultado: RESULTADO_RETORNO_FOLLOWUP, ...refs })
  const fechado = { ...handoff, encerradoEm: handoff.encerradoEm ?? new Date().toISOString(), encerradoMotivo: 'retorno_followup' }
  return { tipo: 'concluido', comando: { ...registro, status: 'concluido', resultado: RESULTADO_RETORNO_FOLLOWUP, ...refs }, resultado: RESULTADO_RETORNO_FOLLOWUP, handoff: fechado }
}
