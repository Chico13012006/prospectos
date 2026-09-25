import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { escolherEmailProvider } from '@/lib/engine'
import { engineConfig } from '@/lib/engine/config'
import { SimulatedProvider } from '@/lib/engine/email/simulatedProvider'
import { resolverContaEmailOrganizacao } from '@/lib/respostas/contaEmailOrganizacao'
import { whatsappModoEnsaio } from '@/lib/whatsapp/outbound'
import { enviarTextoZapiParaLead, type CodigoErroEnvioZapi } from '@/lib/whatsapp/zapi'
import type { DepsMoverLead } from './moverLeadServidor'

// Implementação REAL dos canais do "Mover e enviar" (ver moverLeadServidor).
//   E-mail: conta de PROSPECÇÃO (GMAIL_*_PROSPECCAO, a mesma do 1º contato),
//           salvo quando a organização tem conta dedicada
//           (nomenclaturas.email_conta_key) — aí vale a dela, como em todo
//           envio humano. Trava: MODO_ENSAIO.
//   WhatsApp: Z-API, o mesmo transporte da Central. Trava: WHATSAPP_MODO_ENSAIO
//           (seguro por padrão: só a string 'false' libera o envio real).

type CodigoWhatsapp = 'lead_nao_encontrado' | 'sem_telefone' | 'config_ausente' | 'whatsapp_indisponivel' | 'falha_envio'

const CODIGO_WHATSAPP: Record<CodigoErroEnvioZapi, CodigoWhatsapp> = {
  texto_vazio: 'falha_envio',
  lead_nao_encontrado: 'lead_nao_encontrado',
  sem_telefone: 'sem_telefone',
  config_ausente: 'config_ausente',
  zapi_status_falhou: 'whatsapp_indisponivel',
  zapi_desconectada: 'whatsapp_indisponivel',
  falha_rede: 'falha_envio',
  erro_provider: 'falha_envio',
  resposta_invalida: 'falha_envio',
}

export function modoEnsaioMover(canal: 'email' | 'whatsapp'): boolean {
  return canal === 'email' ? engineConfig.modoEnsaio : whatsappModoEnsaio()
}

export function depsReaisMover(admin: SupabaseClient): DepsMoverLead {
  return {
    agora: () => new Date(),
    modoEnsaio: modoEnsaioMover,

    async enviarEmail(e) {
      const conta = await resolverContaEmailOrganizacao(admin, e.organizacaoId, escolherEmailProvider('prospeccao'))
      if (!conta.ok) return conta
      // Sem credencial o motor cai no provedor simulado: aqui isso viraria um
      // "enviado" falso — erro honesto em vez disso.
      if (conta.provider instanceof SimulatedProvider) {
        return { ok: false, codigo: 'credencial_ausente', mensagem: 'Nenhuma conta de e-mail de prospecção configurada para envio neste ambiente.' }
      }
      try {
        await conta.provider.enviar(e.para, e.assunto, e.texto, e.html)
        return { ok: true }
      } catch (err) {
        return { ok: false, codigo: 'falha_envio', mensagem: `Falha ao enviar: ${err instanceof Error ? err.message : String(err)}` }
      }
    },

    async enviarWhatsapp(e) {
      const r = await enviarTextoZapiParaLead(admin, { leadId: e.leadId, message: e.texto, organizacaoId: e.organizacaoId })
      if (r.ok) return { ok: true, registrada: r.registrada }
      return { ok: false, codigo: CODIGO_WHATSAPP[r.codigo], mensagem: r.mensagem }
    },
  }
}
