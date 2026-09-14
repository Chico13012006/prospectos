// Composição de PRODUÇÃO do gatilho de handoff (server-only): liga os
// repositories Supabase, a config da organização e a Z-API ao serviço puro.
// O motor (lib/engine/index.ts) monta daqui o hook que detectarResposta chama;
// testes e scripts injetam fakes direto no serviço.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { handoffRevisaoMinutosEfetivo, parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { sendGroupText } from '@/lib/whatsapp/zapi'
import { SupabaseHandoffRepository } from './supabaseRepository'
import { SupabaseNotificacaoHandoffRepository } from '../notificacoes/supabaseRepository'
import { reprocessarNotificacoesGrupo, type DepsNotificacaoGrupo } from '../notificacoes/grupoComercial'
import type { EnviadorGrupo } from '../notificacoes/types'
import { processarRespostaPositivaProspeccao, type DepsGatilhoProspeccao, type EntradaGatilhoProspeccao, type ResultadoGatilhoProspeccao } from './gatilhoProspeccao'
import { processarAcompanhamentoHandoff, type DepsAcompanhamento } from './acompanhamentoService'
import { agendarAcompanhamento, executarTickAcompanhamento } from './acompanhamentoScheduler'

// Config comercial da organização (organizacoes.configuracoes.comercial), lida
// no servidor a cada uso — mudar a janela da org de teste vale no próximo ciclo.
async function lerConfigComercialDaOrg(admin: SupabaseClient, organizacaoId: string) {
  const { data, error } = await admin.from('organizacoes').select('configuracoes').eq('id', organizacaoId).maybeSingle()
  if (error) throw new Error(error.message)
  return parseWorkspaceConfig(data?.configuracoes)
}

// Grupo de avisos da organização.
export async function lerGrupoComercialDaOrg(admin: SupabaseClient, organizacaoId: string): Promise<string | null> {
  return (await lerConfigComercialDaOrg(admin, organizacaoId)).comercial?.grupoWhatsappId ?? null
}

// Janela do check-in (minutos), com o padrão de 7 dias.
export async function lerJanelaRevisaoDaOrg(admin: SupabaseClient, organizacaoId: string): Promise<number> {
  return handoffRevisaoMinutosEfetivo(await lerConfigComercialDaOrg(admin, organizacaoId))
}

// Adapter Z-API → porta EnviadorGrupo. Credenciais vêm do env no servidor.
export const enviadorGrupoZapi: EnviadorGrupo = async (grupoId, mensagem) => {
  const r = await sendGroupText({ groupId: grupoId, message: mensagem })
  if (r.ok) return { ok: true, providerMessageId: r.messageId ?? r.zaapId ?? r.id ?? null }
  return { ok: false, codigo: r.codigo, mensagem: r.mensagem }
}

export function montarDepsNotificacaoGrupo(admin: SupabaseClient): DepsNotificacaoGrupo {
  return {
    repo: new SupabaseNotificacaoHandoffRepository(admin),
    enviar: enviadorGrupoZapi,
    lerGrupoId: (org) => lerGrupoComercialDaOrg(admin, org),
  }
}

export function montarDepsGatilhoProspeccao(admin: SupabaseClient): DepsGatilhoProspeccao {
  return {
    handoff: new SupabaseHandoffRepository(admin),
    notificacoes: montarDepsNotificacaoGrupo(admin),
    agendarAcompanhamento: (org) => agendarAcompanhamento(org),
  }
}

export type HookHandoffProspeccao = (entrada: EntradaGatilhoProspeccao) => Promise<ResultadoGatilhoProspeccao>

export function montarHookHandoffProspeccao(admin: SupabaseClient): HookHandoffProspeccao {
  const deps = montarDepsGatilhoProspeccao(admin)
  return (entrada) => processarRespostaPositivaProspeccao(deps, entrada)
}

export function montarDepsAcompanhamento(admin: SupabaseClient, agora?: () => Date): DepsAcompanhamento {
  return {
    handoff: new SupabaseHandoffRepository(admin),
    notificacoes: montarDepsNotificacaoGrupo(admin),
    lerJanelaMinutos: (org) => lerJanelaRevisaoDaOrg(admin, org),
    agora,
  }
}

// Um ciclo de acompanhamento (check-in de 7 dias) para uma organização.
export function processarAcompanhamentoHandoffOrg(admin: SupabaseClient, organizacaoId: string, agora?: () => Date) {
  return processarAcompanhamentoHandoff(montarDepsAcompanhamento(admin, agora), organizacaoId)
}

// Um TICK do scheduler comercial: processa a org e agenda o próximo tick na
// fila durável, se houver o que esperar. Usado pelo handler da fila e pelo
// cron diário (que re-semeia a corrente de cada org).
export function executarTickAcompanhamentoOrg(admin: SupabaseClient, organizacaoId: string) {
  return executarTickAcompanhamento((org) => processarAcompanhamentoHandoffOrg(admin, org), organizacaoId)
}

// Recuperação dos avisos que ficaram para trás (Z-API fora, grupo sem config…).
export function reprocessarAlertasHandoff(admin: SupabaseClient, organizacaoId: string, limite?: number) {
  return reprocessarNotificacoesGrupo(montarDepsNotificacaoGrupo(admin), organizacaoId, limite)
}
