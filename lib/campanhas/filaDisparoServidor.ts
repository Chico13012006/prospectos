import 'server-only'
import { send } from '@vercel/queue'
import type { WorkflowStore } from '@/lib/workflows'

export const TOPICO_FILA_CAMPANHA = 'campanhas-email-v1'
export const INTERVALO_ENVIO_CAMPANHA_SEGUNDOS = 120
export const RETENCAO_FILA_CAMPANHA_SEGUNDOS = 7 * 24 * 60 * 60

export interface MensagemFilaCampanha {
  organizacaoId: string
  campanhaId: string
  execucaoId: string
}

export interface ItemAgendaCampanha extends MensagemFilaCampanha {
  agendadoPara: string
  delaySeconds: number
  idempotencyKey: string
}

type Enfileirar = (
  topico: string,
  mensagem: MensagemFilaCampanha,
  opcoes: {
    delaySeconds: number
    retentionSeconds: number
    idempotencyKey: string
  },
) => Promise<unknown>

function valorNaoVazio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim().length > 0
}

export class MensagemFilaCampanhaInvalida extends Error {}

export function validarMensagemFilaCampanha(valor: unknown): MensagemFilaCampanha {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new MensagemFilaCampanhaInvalida('Mensagem da fila de campanha inválida.')
  }
  const mensagem = valor as Record<string, unknown>
  if (
    !valorNaoVazio(mensagem.organizacaoId)
    || !valorNaoVazio(mensagem.campanhaId)
    || !valorNaoVazio(mensagem.execucaoId)
  ) {
    throw new MensagemFilaCampanhaInvalida('Mensagem da fila de campanha incompleta.')
  }
  return {
    organizacaoId: mensagem.organizacaoId,
    campanhaId: mensagem.campanhaId,
    execucaoId: mensagem.execucaoId,
  }
}

export function montarAgendaDisparoCampanha(
  organizacaoId: string,
  campanhaId: string,
  execucaoIds: string[],
  agora: Date = new Date(),
): ItemAgendaCampanha[] {
  const ids = [...new Set(execucaoIds.filter(valorNaoVazio))]
  return ids.map((execucaoId, indice) => {
    const delaySeconds = indice * INTERVALO_ENVIO_CAMPANHA_SEGUNDOS
    return {
      organizacaoId,
      campanhaId,
      execucaoId,
      agendadoPara: new Date(agora.getTime() + delaySeconds * 1_000).toISOString(),
      delaySeconds,
      idempotencyKey: `campanha:${campanhaId}:execucao:${execucaoId}`,
    }
  })
}

export async function agendarExecucoesCampanha(
  store: WorkflowStore,
  organizacaoId: string,
  campanhaId: string,
  execucaoIds: string[],
  opcoes: { agora?: Date; enfileirar?: Enfileirar } = {},
): Promise<{
  agendadas: number
  ignoradas: number
  primeiraExecucaoEm: string | null
  ultimaExecucaoEm: string | null
}> {
  if (store.organizacaoId && store.organizacaoId !== organizacaoId) {
    throw new Error('A fila não pode misturar execuções de organizações diferentes.')
  }
  const agora = opcoes.agora ?? new Date()
  const enfileirar = opcoes.enfileirar ?? send
  const agenda = montarAgendaDisparoCampanha(organizacaoId, campanhaId, execucaoIds, agora)
  let agendadas = 0
  let ignoradas = 0
  let primeiraExecucaoEm: string | null = null
  let ultimaExecucaoEm: string | null = null

  for (const item of agenda) {
    const execucao = await store.buscarExecucao(item.execucaoId)
    if (
      !execucao
      || execucao.campanha_id !== campanhaId
      || execucao.status === 'concluido'
      || execucao.status === 'cancelado'
    ) {
      ignoradas += 1
      continue
    }

    await store.atualizarExecucao(item.execucaoId, {
      status: 'aguardando',
      proxima_verificacao_em: item.agendadoPara,
      atualizado_em: agora.toISOString(),
    })

    const atrasoAtual = Math.max(
      0,
      Math.ceil((new Date(item.agendadoPara).getTime() - Date.now()) / 1_000),
    )
    await enfileirar(TOPICO_FILA_CAMPANHA, {
      organizacaoId: item.organizacaoId,
      campanhaId: item.campanhaId,
      execucaoId: item.execucaoId,
    }, {
      delaySeconds: atrasoAtual,
      retentionSeconds: RETENCAO_FILA_CAMPANHA_SEGUNDOS,
      idempotencyKey: item.idempotencyKey,
    })
    await store.registrarEvento({
      execucao_id: item.execucaoId,
      tipo: 'disparo_enfileirado',
      detalhe: {
        campanha_id: campanhaId,
        agendado_para: item.agendadoPara,
        intervalo_segundos: INTERVALO_ENVIO_CAMPANHA_SEGUNDOS,
      },
    })
    primeiraExecucaoEm ??= item.agendadoPara
    ultimaExecucaoEm = item.agendadoPara
    agendadas += 1
  }

  return { agendadas, ignoradas, primeiraExecucaoEm, ultimaExecucaoEm }
}
