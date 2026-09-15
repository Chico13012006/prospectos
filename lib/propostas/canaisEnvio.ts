import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarMotorReal } from '@/lib/engine/scheduler'
import { engineConfig } from '@/lib/engine/config'
import { SimulatedProvider } from '@/lib/engine/email/simulatedProvider'
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import { resolverContaEmailOrganizacao } from '@/lib/respostas/contaEmailOrganizacao'
import { enviarDocumentoZapiParaLead, type CodigoErroEnvioDocumentoZapi } from '@/lib/whatsapp/zapi'
import { gerarPdfPropostaServidor } from './pdfServidor'
import type { DepsEnvioProposta } from './enviarPropostaServidor'

// Implementação REAL dos canais do envio de proposta (ver enviarPropostaServidor).
//   E-mail: mesma conta da organização, assinatura do responsável e trava
//           MODO_ENSAIO da Central de Respostas — com o PDF como anexo.
//   WhatsApp: Z-API, o mesmo transporte da Central — PDF como documento e a
//           mensagem como legenda.

type CodigoWhatsappProposta = 'lead_nao_encontrado' | 'sem_telefone' | 'config_ausente' | 'whatsapp_indisponivel' | 'falha_envio'

const CODIGO_WHATSAPP: Record<CodigoErroEnvioDocumentoZapi, CodigoWhatsappProposta> = {
  documento_vazio: 'falha_envio',
  lead_nao_encontrado: 'lead_nao_encontrado',
  sem_telefone: 'sem_telefone',
  config_ausente: 'config_ausente',
  zapi_status_falhou: 'whatsapp_indisponivel',
  zapi_desconectada: 'whatsapp_indisponivel',
  falha_rede: 'falha_envio',
  erro_provider: 'falha_envio',
  resposta_invalida: 'falha_envio',
}

export function depsReaisEnvioProposta(admin: SupabaseClient): DepsEnvioProposta {
  return {
    agora: () => new Date(),
    modoEnsaioEmail: () => engineConfig.modoEnsaio,
    gerarPdf: gerarPdfPropostaServidor,

    async enviarEmail(e) {
      const motor = criarMotorReal(e.organizacaoId)
      const conta = await resolverContaEmailOrganizacao(admin, e.organizacaoId, motor.email)
      if (!conta.ok) return conta
      // Sem GMAIL_USER o motor cai no provedor simulado. Aqui isso viraria um
      // "enviado" falso para o cliente — erro honesto em vez disso.
      if (conta.provider instanceof SimulatedProvider) {
        return { ok: false, codigo: 'credencial_ausente', mensagem: 'Nenhuma conta de e-mail configurada para envio neste ambiente.' }
      }
      const responsavel = e.responsavelId ? await motor.store.buscarUsuario(e.responsavelId) : null
      const html = montarEmailCampanhaHtml(e.texto, { responsavelNome: responsavel?.nome ?? null, nomeServico: conta.nomeServico })
      try {
        await conta.provider.enviar(e.para, e.assunto, e.texto, html, undefined, [e.anexo])
        return { ok: true }
      } catch (err) {
        return { ok: false, codigo: 'falha_envio', mensagem: `Falha ao enviar: ${err instanceof Error ? err.message : String(err)}` }
      }
    },

    async enviarWhatsapp(e) {
      const r = await enviarDocumentoZapiParaLead(admin, {
        leadId: e.leadId,
        organizacaoId: e.organizacaoId,
        pdf: e.pdf,
        fileName: e.nomeArquivo,
        caption: e.legenda,
      })
      if (r.ok) return { ok: true, registrada: r.registrada }
      return { ok: false, codigo: CODIGO_WHATSAPP[r.codigo], mensagem: r.mensagem }
    },
  }
}
