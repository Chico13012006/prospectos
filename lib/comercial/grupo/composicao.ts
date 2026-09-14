// Composição de PRODUÇÃO dos comandos do grupo (server-only). O webhook e o
// cron diário só chamam daqui; a regra fica em comandoService.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseHandoffRepository } from '../handoff/supabaseRepository'
import { SupabaseNotificacaoHandoffRepository } from '../notificacoes/supabaseRepository'
import { montarDepsRetornoFollowup } from '../followup/composicao'
import { SupabaseComandoGrupoRepository } from './supabaseRepository'
import { processarComandoGrupo, reprocessarComandosGrupo, type DepsComandoGrupo } from './comandoService'
import type { EventoGrupo } from './callbackGrupo'

export function montarDepsComandoGrupo(admin: SupabaseClient): DepsComandoGrupo {
  return {
    comandos: new SupabaseComandoGrupoRepository(admin),
    notificacoes: new SupabaseNotificacaoHandoffRepository(admin),
    handoff: new SupabaseHandoffRepository(admin),
    retorno: montarDepsRetornoFollowup(admin),
  }
}

export function processarComandoGrupoZapi(admin: SupabaseClient, evento: EventoGrupo) {
  return processarComandoGrupo(montarDepsComandoGrupo(admin), evento)
}

// Retoma comandos recebidos/falhos/presos de uma org (cron diário / rota interna).
export function reprocessarComandosGrupoOrg(admin: SupabaseClient, organizacaoId: string, limite?: number) {
  return reprocessarComandosGrupo(montarDepsComandoGrupo(admin), organizacaoId, limite)
}
