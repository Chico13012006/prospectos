import { handleCallback } from '@vercel/queue'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { engineConfig } from '@/lib/engine/config'
import { processarRespostasOrganizacao } from '@/lib/engine'
import {
  agendarMonitorRespostas,
  haEnvioRecenteParaMonitorar,
  MensagemMonitorRespostasInvalida,
  validarMensagemMonitorRespostas,
} from '@/lib/engine/respostasAutomaticas'

export const runtime = 'nodejs'

export const POST = handleCallback(
  async (mensagem) => {
    const dados = validarMensagemMonitorRespostas(mensagem)
    // Ao voltar para ensaio, o monitor para sem tocar na caixa. Um novo envio
    // real reinicia a cadeia quando o ambiente for liberado novamente.
    if (engineConfig.modoEnsaio) return

    const admin = createSupabaseAdminClient()
    if (!await haEnvioRecenteParaMonitorar(admin, dados.organizacaoId)) return

    await processarRespostasOrganizacao(dados.organizacaoId)
    await agendarMonitorRespostas(dados.organizacaoId)
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (erro, metadata) => {
      if (erro instanceof MensagemMonitorRespostasInvalida) return { acknowledge: true }
      if (metadata.deliveryCount >= 5) return { acknowledge: true }
      return { afterSeconds: Math.min(300, 30 * 2 ** (metadata.deliveryCount - 1)) }
    },
  },
)
