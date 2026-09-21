import { handleCallback } from '@vercel/queue'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { AmbienteSupabase, registrarBlocosPadrao, SupabaseWorkflowStore } from '@/lib/workflows'
import { MensagemRetomadaInvalida, retomarProspeccao, validarMensagemRetomada } from '@/lib/workflows/retomadaProspeccao'
import { ErroEnvioIncerto } from '@/lib/workflows/ambiente'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = handleCallback(async (mensagem) => {
  const dados = validarMensagemRetomada(mensagem)
  const admin = createSupabaseAdminClient()
  const store = new SupabaseWorkflowStore(dados.organizacaoId, admin)
  await retomarProspeccao(
    store, registrarBlocosPadrao(), new AmbienteSupabase(dados.organizacaoId, { client: admin }), dados,
  )
}, {
  visibilityTimeoutSeconds: 360,
  retry: (erro, metadata) => {
    if (erro instanceof MensagemRetomadaInvalida || erro instanceof ErroEnvioIncerto) return { acknowledge: true }
    if (metadata.deliveryCount >= 5) return { acknowledge: true }
    return { afterSeconds: Math.min(300, 30 * 2 ** (metadata.deliveryCount - 1)) }
  },
})
