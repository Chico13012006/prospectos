// Scheduler COMERCIAL do acompanhamento (Fase 3) — independente de e-mail.
//
// Por que fila durável e não cron: o projeto está no Vercel Hobby, onde cron
// roda no máximo 1×/dia. A fila durável (@vercel/queue) é o mecanismo já usado
// pelo monitor de respostas para granularidade de minutos. Aqui é uma CORRENTE
// PRÓPRIA do domínio comercial (tópico comercial-acompanhamento-v1): cada
// mensagem é um "tick" de uma organização; o handler chama o serviço e agenda
// o próximo tick com base no que o serviço devolveu.
//
// Cadência adaptativa (custo baixo, tolerância de minutos):
//   - há check-in vencido que ainda precisa de nova tentativa → volta em 10 min;
//   - próximo handoff a vencer daqui a X → dorme min(max(X, 2 min), 30 min);
//   - nada aberto para acompanhar → a corrente MORRE (nada é agendado).
// A corrente nasce quando um handoff é atribuído (gatilho da Fase 2) e é
// re-semeada pelo cron diário do domínio (/api/comercial/handoff/acompanhamento)
// — rede de segurança para deploy/queda, não o mecanismo principal.
//
// Idempotência da corrente: a mensagem tem chave `acompanhamento:<org>:<slot>`,
// com o slot na grade absoluta de 2 min. Quem quer que agende para o mesmo slot
// (handoff novo + cron + tick anterior) produz UMA mensagem. Duplicidade de
// ENVIO nunca depende disto: é o outbox (unique + compare-and-swap) que garante
// uma única chamada à Z-API por check-in, mesmo com duas correntes vivas.
import 'server-only'
import { send } from '@vercel/queue'
import type { ResumoAcompanhamento } from './acompanhamentoService'

export const TOPICO_ACOMPANHAMENTO = 'comercial-acompanhamento-v1'
export const INTERVALO_MIN_SEGUNDOS = 120       // grade e menor espera
export const INTERVALO_MAX_SEGUNDOS = 1800      // maior espera longe do vencimento
export const INTERVALO_RETENTATIVA_SEGUNDOS = 600 // check-in que falhou/sem grupo
const FOLGA_RETENCAO_SEGUNDOS = 600

export interface MensagemAcompanhamento {
  organizacaoId: string
  slot: number // epoch em segundos, na grade de INTERVALO_MIN_SEGUNDOS
}

export class MensagemAcompanhamentoInvalida extends Error {}

export function validarMensagemAcompanhamento(valor: unknown): MensagemAcompanhamento {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new MensagemAcompanhamentoInvalida('Mensagem de acompanhamento inválida.')
  }
  const m = valor as Record<string, unknown>
  if (typeof m.organizacaoId !== 'string' || !m.organizacaoId.trim() || !Number.isInteger(m.slot) || Number(m.slot) < 0) {
    throw new MensagemAcompanhamentoInvalida('Mensagem de acompanhamento incompleta.')
  }
  return { organizacaoId: m.organizacaoId, slot: Number(m.slot) }
}

/**
 * Em quantos segundos o próximo tick deve rodar, dado o resumo do serviço.
 * null = nada a acompanhar → a corrente termina.
 */
export function calcularProximoTick(agora: Date, resumo: Pick<ResumoAcompanhamento, 'proximoVencimentoEm' | 'haPendentes'>): number | null {
  if (resumo.haPendentes) return INTERVALO_RETENTATIVA_SEGUNDOS
  if (!resumo.proximoVencimentoEm) return null
  const faltam = Math.ceil((new Date(resumo.proximoVencimentoEm).getTime() - agora.getTime()) / 1000)
  return Math.min(INTERVALO_MAX_SEGUNDOS, Math.max(INTERVALO_MIN_SEGUNDOS, faltam))
}

export interface Agendamento {
  mensagem: MensagemAcompanhamento
  agendadoPara: string
  delaySeconds: number
  retentionSeconds: number
  idempotencyKey: string
}

// Alinha o alvo à grade absoluta de 2 min (nunca antes do pedido) — é o que
// faz agendamentos concorrentes para o mesmo momento colapsarem numa mensagem.
export function montarAgendamento(organizacaoId: string, delaySeconds: number, agora: Date = new Date()): Agendamento {
  if (!organizacaoId.trim()) throw new Error('Organização obrigatória para agendar o acompanhamento.')
  const alvoMs = agora.getTime() + Math.max(0, delaySeconds) * 1000
  const slot = Math.ceil(alvoMs / 1000 / INTERVALO_MIN_SEGUNDOS) * INTERVALO_MIN_SEGUNDOS
  const delay = Math.max(0, slot - Math.floor(agora.getTime() / 1000))
  return {
    mensagem: { organizacaoId, slot },
    agendadoPara: new Date(slot * 1000).toISOString(),
    delaySeconds: delay,
    retentionSeconds: delay + FOLGA_RETENCAO_SEGUNDOS,
    idempotencyKey: `acompanhamento:${organizacaoId}:${slot}`,
  }
}

export type EnfileirarAcompanhamento = (
  topico: string,
  mensagem: MensagemAcompanhamento,
  opcoes: { delaySeconds: number; retentionSeconds: number; idempotencyKey: string },
) => Promise<unknown>

// Agenda um tick da organização daqui a `delaySeconds` (padrão: o mínimo).
export async function agendarAcompanhamento(
  organizacaoId: string,
  opcoes: { delaySeconds?: number; agora?: Date; enfileirar?: EnfileirarAcompanhamento } = {},
): Promise<Agendamento> {
  const agenda = montarAgendamento(organizacaoId, opcoes.delaySeconds ?? INTERVALO_MIN_SEGUNDOS, opcoes.agora)
  await (opcoes.enfileirar ?? send)(TOPICO_ACOMPANHAMENTO, agenda.mensagem, {
    delaySeconds: agenda.delaySeconds,
    retentionSeconds: agenda.retentionSeconds,
    idempotencyKey: agenda.idempotencyKey,
  })
  return agenda
}

/**
 * Um tick completo: processa a organização e agenda o próximo, se houver o que
 * esperar. É o que o handler da fila e o cron diário executam.
 */
export async function executarTickAcompanhamento(
  processar: (organizacaoId: string) => Promise<ResumoAcompanhamento>,
  organizacaoId: string,
  opcoes: { agora?: Date; enfileirar?: EnfileirarAcompanhamento } = {},
): Promise<{ resumo: ResumoAcompanhamento; proximo: Agendamento | null }> {
  const resumo = await processar(organizacaoId)
  const delay = calcularProximoTick(opcoes.agora ?? new Date(), resumo)
  if (delay === null) return { resumo, proximo: null }
  const proximo = await agendarAcompanhamento(organizacaoId, { delaySeconds: delay, agora: opcoes.agora, enfileirar: opcoes.enfileirar })
  return { resumo, proximo }
}
