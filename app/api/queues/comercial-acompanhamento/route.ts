// Handler da fila durável do ACOMPANHAMENTO COMERCIAL (Fase 3). Cada mensagem
// é um tick de UMA organização: processa o check-in de 7 dias (serviço em
// lib/comercial/handoff/acompanhamentoService) e agenda o próximo tick quando
// há o que esperar. Independente de e-mail/cadência — a corrente nasce no
// handoff e é re-semeada pelo cron diário /api/comercial/handoff/acompanhamento.
// Mesmo padrão dos outros handlers (@vercel/queue) e o trigger fica em vercel.json.
import { handleCallback } from '@vercel/queue'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { executarTickAcompanhamentoOrg } from '@/lib/comercial/handoff/composicao'
import { MensagemAcompanhamentoInvalida, validarMensagemAcompanhamento } from '@/lib/comercial/handoff/acompanhamentoScheduler'

export const runtime = 'nodejs'

export const POST = handleCallback(
  async (mensagem) => {
    const dados = validarMensagemAcompanhamento(mensagem)
    const admin = createSupabaseAdminClient()
    // Org-scoped: o tick só toca a organização da mensagem.
    await executarTickAcompanhamentoOrg(admin, dados.organizacaoId)
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (erro, metadata) => {
      if (erro instanceof MensagemAcompanhamentoInvalida) return { acknowledge: true }
      if (metadata.deliveryCount >= 5) return { acknowledge: true }
      return { afterSeconds: Math.min(300, 30 * 2 ** (metadata.deliveryCount - 1)) }
    },
  },
)
