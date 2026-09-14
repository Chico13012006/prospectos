// Retorno ao follow-up automático (Fase 4, comando "#CODIGO 2").
//
// Reusa o motor de workflows/campanhas — NÃO é uma segunda engine:
//   * a organização tem uma campanha de FOLLOW-UP (tipo 'followup', ativa,
//     envio real) cuja primeira mensagem É o follow-up 1 (a campanha de
//     follow-up nunca manda "primeiro contato" — esse é o de prospecção);
//   * o lead é inscrito no workflow dessa campanha com
//     ciclo_chave = 'handoff_retorno:<handoffId>' — a identidade do ciclo
//     (inscrição idempotente: repetir devolve a mesma execução) E a origem
//     explícita que a Fase 2 usa para saber que a resposta a ESTE follow-up
//     deve reativar o handoff para o mesmo comercial. Um follow-up importado
//     (HubSpot) nunca tem essa chave — por isso nunca entra no handoff;
//   * o lead volta ao estágio 'follow_up' (esteira/Kanban) — o motor legado
//     ignora leads com execução de workflow ativa, então só o workflow envia;
//   * a primeira mensagem é agendada na fila de campanha (mesmo mecanismo da
//     renovação), respeitando agenda/limite da campanha.
//
// Toda etapa é idempotente; o comando que chama isto pode ser reprocessado.
import type { RegistroHandoff } from '../handoff/types'

export const PREFIXO_CICLO_HANDOFF_RETORNO = 'handoff_retorno:'

export function cicloChaveRetorno(handoffId: string): string {
  return `${PREFIXO_CICLO_HANDOFF_RETORNO}${handoffId}`
}

// Execução de workflow originada por "voltar para follow-up"?
export function ehCicloDeRetornoHandoff(cicloChave: string | null | undefined): boolean {
  return typeof cicloChave === 'string' && cicloChave.startsWith(PREFIXO_CICLO_HANDOFF_RETORNO)
}

export type CampanhaRetorno =
  | { ok: true; campanhaId: string; workflowId: string }
  | { ok: false; motivo: 'sem_campanha_retorno' | 'campanha_retorno_ambigua' | 'campanha_retorno_invalida'; detalhe?: string }

export interface DepsRetornoFollowup {
  // Campanha de follow-up de retorno da org (config explícita ou a única ativa).
  resolverCampanhaRetorno(organizacaoId: string): Promise<CampanhaRetorno>
  // inscreverLeadManual do motor de workflows, com ciclo_chave.
  inscrever(organizacaoId: string, workflowId: string, leadId: string, campanhaId: string, cicloChave: string): Promise<{ execucaoId: string; jaInscrito: boolean }>
  // leads.estagio → 'follow_up' (+ proxima_acao); idempotente.
  moverLeadParaFollowup(organizacaoId: string, leadId: string): Promise<void>
  // Primeira mensagem na fila de campanha (idempotente pela chave campanha+execução).
  agendarPrimeiroEnvio(organizacaoId: string, campanhaId: string, execucaoId: string): Promise<void>
}

export type ResultadoRetornoFollowup =
  | { ok: true; campanhaId: string; execucaoId: string; jaInscrito: boolean }
  | { ok: false; motivo: 'sem_campanha_retorno' | 'campanha_retorno_ambigua' | 'campanha_retorno_invalida'; detalhe?: string }

export async function iniciarFollowupDeRetorno(
  deps: DepsRetornoFollowup,
  organizacaoId: string,
  handoff: RegistroHandoff,
): Promise<ResultadoRetornoFollowup> {
  const campanha = await deps.resolverCampanhaRetorno(organizacaoId)
  if (!campanha.ok) return campanha
  const inscricao = await deps.inscrever(organizacaoId, campanha.workflowId, handoff.leadId, campanha.campanhaId, cicloChaveRetorno(handoff.id))
  await deps.moverLeadParaFollowup(organizacaoId, handoff.leadId)
  await deps.agendarPrimeiroEnvio(organizacaoId, campanha.campanhaId, inscricao.execucaoId)
  return { ok: true, campanhaId: campanha.campanhaId, execucaoId: inscricao.execucaoId, jaInscrito: inscricao.jaInscrito }
}
