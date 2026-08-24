import { handleCallback } from '@vercel/queue'
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

    await processarExecucoesCampanha(
      store,
      registrarBlocosPadrao(),
      new AmbienteSupabase(dados.organizacaoId, { client: admin }),
      dados.campanhaId,
      [dados.execucaoId],
      new Date().toISOString(),
      {
        propagarErro: true,
        permitirRetryErro: true,
        ignorarAgendaCampanha: true,
      },
    )
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
