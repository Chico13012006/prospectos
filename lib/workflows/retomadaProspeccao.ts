import 'server-only'
import { randomUUID } from 'node:crypto'
import { send } from '@vercel/queue'
import type { AmbienteWorkflow } from './ambiente'
import { processarExecucao } from './executor'
import type { RegistroWorkflows } from './registro'
import type { WorkflowStore } from './store/store'
import { log } from '@/lib/engine/logger'
import type { WorkflowExecucao } from './types'

export const TOPICO_RETOMADA_PROSPECCAO = 'workflows-retomada-v1'
const TRECHO_SEGUNDOS = 6 * 24 * 60 * 60 // abaixo do limite de 7 dias da fila
const RETENCAO_SEGUNDOS = 7 * 24 * 60 * 60

export interface MensagemRetomadaProspeccao {
  organizacaoId: string
  execucaoId: string
  geracao: number
}

export class MensagemRetomadaInvalida extends Error {}

export function validarMensagemRetomada(valor: unknown): MensagemRetomadaProspeccao {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new MensagemRetomadaInvalida('Payload de retomada inválido.')
  const m = valor as Record<string, unknown>
  if (typeof m.organizacaoId !== 'string' || !m.organizacaoId.trim()
    || typeof m.execucaoId !== 'string' || !m.execucaoId.trim()
    || !Number.isSafeInteger(m.geracao) || (m.geracao as number) < 0) {
    throw new MensagemRetomadaInvalida('Payload de retomada incompleto.')
  }
  return { organizacaoId: m.organizacaoId, execucaoId: m.execucaoId, geracao: m.geracao as number }
}

export type EnfileirarRetomada = typeof send

function exigirStore(store: WorkflowStore): asserts store is WorkflowStore & Required<Pick<WorkflowStore,
  'reivindicarPublicacaoProspeccao' | 'confirmarPublicacaoProspeccao' | 'liberarPublicacaoProspeccao'
  | 'rearmarRetomadaProspeccao' | 'reivindicarRetomadaProspeccao' | 'liberarRetomadaProspeccao'
  | 'listarRetomadasProspeccao'>> {
  if (!store.organizacaoId || !store.reivindicarPublicacaoProspeccao
    || !store.confirmarPublicacaoProspeccao || !store.liberarPublicacaoProspeccao
    || !store.rearmarRetomadaProspeccao || !store.reivindicarRetomadaProspeccao
    || !store.liberarRetomadaProspeccao || !store.listarRetomadasProspeccao) {
    throw new Error('Store de retomada da prospecção indisponível.')
  }
}

export async function publicarRetomadaProspeccao(
  store: WorkflowStore,
  ex: WorkflowExecucao,
  opcoes: { agora?: Date; enfileirar?: EnfileirarRetomada } = {},
): Promise<boolean> {
  exigirStore(store)
  if (ex.organizacao_id && ex.organizacao_id !== store.organizacaoId) throw new Error('Execução de outra organização.')
  const geracao = ex.agendamento_geracao ?? 0
  if (ex.status !== 'aguardando' || geracao < 0 || !ex.proxima_verificacao_em) return false
  const agora = opcoes.agora ?? new Date()
  const vencimento = new Date(ex.proxima_verificacao_em).getTime()
  if (!Number.isFinite(vencimento)) throw new Error('Vencimento de workflow inválido.')
  const checkpoint = new Date(Math.min(vencimento, agora.getTime() + TRECHO_SEGUNDOS * 1_000))
  const token = randomUUID()
  const reivindicou = await store.reivindicarPublicacaoProspeccao(ex.id, geracao, token, checkpoint.toISOString())
  if (!reivindicou) return false
  try {
    const delaySeconds = Math.max(0, Math.ceil((checkpoint.getTime() - Date.now()) / 1_000))
    await (opcoes.enfileirar ?? send)(TOPICO_RETOMADA_PROSPECCAO,
      { organizacaoId: store.organizacaoId, execucaoId: ex.id, geracao },
      { delaySeconds, retentionSeconds: RETENCAO_SEGUNDOS,
        idempotencyKey: `retomada:${store.organizacaoId}:${ex.id}:${geracao}` })
    await store.confirmarPublicacaoProspeccao(ex.id, geracao, token)
    await store.registrarEvento({ execucao_id: ex.id, tipo: 'retomada_enfileirada',
      detalhe: { geracao, checkpoint_em: checkpoint.toISOString(), vencimento_em: ex.proxima_verificacao_em } })
    return true
  } catch (erro) {
    await store.liberarPublicacaoProspeccao(ex.id, geracao, token)
    throw erro
  }
}

export async function retomarProspeccao(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  mensagem: MensagemRetomadaProspeccao,
  opcoes: { agora?: Date; enfileirar?: EnfileirarRetomada } = {},
): Promise<'ignorada' | 'rearmada' | 'processada'> {
  exigirStore(store)
  if (store.organizacaoId !== mensagem.organizacaoId || ambiente.organizacaoId !== mensagem.organizacaoId) {
    throw new MensagemRetomadaInvalida('Organização incompatível com o worker.')
  }
  const ex = await store.buscarExecucao(mensagem.execucaoId)
  if (!ex || ex.organizacao_id && ex.organizacao_id !== mensagem.organizacaoId
    || ex.status !== 'aguardando' || ex.agendamento_geracao !== mensagem.geracao
    || !ex.proxima_verificacao_em) return 'ignorada'

  const agora = opcoes.agora ?? new Date()
  if (new Date(ex.proxima_verificacao_em).getTime() > agora.getTime()) {
    const rearmada = await store.rearmarRetomadaProspeccao(ex.id, mensagem.geracao)
    if (!rearmada) return 'ignorada'
    await publicarRetomadaProspeccao(store, rearmada, opcoes)
    return 'rearmada'
  }

  const token = randomUUID()
  const claim = await store.reivindicarRetomadaProspeccao(ex.id, mensagem.geracao, ex.passo_atual, token)
  if (!claim) return 'ignorada'
  try {
    await store.registrarEvento({ execucao_id: ex.id, tipo: 'retomada_reivindicada',
      detalhe: { geracao: mensagem.geracao, passo: ex.passo_atual } })
    await processarExecucao(store, registro, ambiente, ex.id, agora.toISOString(), {
      claimToken: token, propagarErro: true, ignorarAgendaCampanha: true,
      enfileirarRetomada: opcoes.enfileirar,
    })
    return 'processada'
  } finally {
    await store.liberarRetomadaProspeccao(ex.id, token)
  }
}

// Cron diário: somente repara mensagens/claims perdidos. Nunca executa ações.
export async function reconciliarRetomadasProspeccao(
  store: WorkflowStore,
  opcoes: { agora?: Date; enfileirar?: EnfileirarRetomada; maxLotes?: number } = {},
): Promise<{ examinadas: number; publicadas: number; falhas: number }> {
  exigirStore(store)
  const agora = opcoes.agora ?? new Date()
  let cursor: string | null = null
  let examinadas = 0
  let publicadas = 0
  let falhas = 0
  for (let lote = 0; lote < (opcoes.maxLotes ?? 50); lote++) {
    const linhas = await store.listarRetomadasProspeccao(cursor, 200)
    if (linhas.length === 0) break
    for (const ex of linhas) {
      cursor = ex.id
      examinadas++
      // Cinto e suspensório: a função SQL já filtra por organização, mas o
      // watchdog nunca pode reagendar execução de outro tenant.
      if (ex.organizacao_id && ex.organizacao_id !== store.organizacaoId) throw new Error('Watchdog recebeu outra organização.')
      // Uma execução problemática não pode cancelar o reparo das demais: a fila
      // pode recusar um único job e a varredura precisa seguir.
      try {
        const vencida = !!ex.proxima_verificacao_em && new Date(ex.proxima_verificacao_em).getTime() <= agora.getTime()
        const checkpointVencido = !!ex.agendamento_checkpoint_em
          && new Date(ex.agendamento_checkpoint_em).getTime() <= agora.getTime()
        const publicacaoAusente = !ex.agendamento_publicado_em
        const candidata = (vencida || checkpointVencido) && !publicacaoAusente
          ? await store.rearmarRetomadaProspeccao(ex.id, ex.agendamento_geracao ?? 0)
          : ex
        if (candidata && await publicarRetomadaProspeccao(store, candidata, opcoes)) publicadas++
      } catch (erro) {
        falhas++
        log.erro('Reconciliação de retomada falhou para uma execução.', {
          organizacaoId: store.organizacaoId, execucaoId: ex.id,
          erro: erro instanceof Error ? erro.message : String(erro),
        })
      }
    }
    if (linhas.length < 200) break
  }
  return { examinadas, publicadas, falhas }
}
