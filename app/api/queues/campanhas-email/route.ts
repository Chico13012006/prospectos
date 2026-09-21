import { handleCallback } from '@vercel/queue'
import { randomUUID } from 'node:crypto'
import {
  MensagemFilaCampanhaInvalida,
  validarMensagemFilaCampanha,
} from '@/lib/campanhas/filaDisparoServidor'
import {
  AmbienteSupabase,
  processarExecucoesCampanha,
  registrarBlocosPadrao,
  SupabaseWorkflowStore,
} from '@/lib/workflows'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

export const POST = handleCallback(
  async (mensagem) => {
    const dados = validarMensagemFilaCampanha(mensagem)
    const admin = createSupabaseAdminClient()
    const store = new SupabaseWorkflowStore(dados.organizacaoId, admin)
    const execucao = await store.buscarExecucao(dados.execucaoId)
    if (!execucao || execucao.campanha_id !== dados.campanhaId) {
      throw new MensagemFilaCampanhaInvalida('Execução ausente ou incompatível com a campanha.')
    }
    const ambiente = new AmbienteSupabase(dados.organizacaoId, { client: admin })
    const controle = await ambiente.buscarControleExecucaoCampanha(dados.campanhaId)
    if (controle?.tipo === 'prospeccao' && (execucao.agendamento_geracao ?? 0) > 0) return
    const token = controle?.tipo === 'prospeccao' ? randomUUID() : null
    if (token) {
      // Primeiro e-mail também precisa de exclusão mútua: dois callbacks da
      // campanha não podem iniciar o mesmo passo antes da primeira espera.
      const claim = await store.reivindicarRetomadaProspeccao(
        execucao.id, execucao.agendamento_geracao ?? 0, execucao.passo_atual, token,
      )
      if (!claim) {
        // Entrega adiantada da fila (o claim exige proxima_verificacao_em
        // vencida no relógio do banco): devolve para retry curto em vez de
        // descartar o primeiro e-mail até o watchdog diário.
        const atual = await store.buscarExecucao(execucao.id)
        if (atual?.status === 'aguardando' && (atual.agendamento_geracao ?? 0) === 0
          && atual.proxima_verificacao_em
          && new Date(atual.proxima_verificacao_em).getTime() > Date.now()) {
          throw new Error('Disparo da campanha ainda não venceu; retry curto da fila.')
        }
        return
      }
    }
    try {
      await processarExecucoesCampanha(
        store,
        registrarBlocosPadrao(),
        ambiente,
        dados.campanhaId,
        [dados.execucaoId],
        new Date().toISOString(),
        {
          propagarErro: true,
          permitirRetryErro: true,
          ignorarAgendaCampanha: true,
          claimToken: token ?? undefined,
        },
      )
    } finally {
      if (token) await store.liberarRetomadaProspeccao(execucao.id, token)
    }
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (erro, metadata) => {
      if (erro instanceof MensagemFilaCampanhaInvalida) return { acknowledge: true }
      if (metadata.deliveryCount >= 5) return { acknowledge: true }
      return { afterSeconds: Math.min(300, 30 * 2 ** (metadata.deliveryCount - 1)) }
    },
  },
)
