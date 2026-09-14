// Estágio com que um lead NASCE na base. Fonte única da regra "cliente com
// validade de laudo entra em renovação, não em prospecção". Módulo PURO (sem
// banco): usado pela importação CSV no servidor e pelo script de correção da
// base (scripts/aplicar-estagio-renovacao.ts).
//
// `renovacao` é um estágio próprio, diferente de `follow_up`: fica fora da
// esteira de prospecção (ESTAGIOS_EM_CADENCIA), do público das campanhas de
// follow-up e da "próxima etapa" manual. A campanha de renovação continua
// selecionando por validade — o estágio não é critério dela.
//
// A regra vale POR ORGANIZAÇÃO (features.estagioRenovacaoPorValidade). Sem a
// flag, o comportamento é o de sempre: todo lead importado nasce em
// `novos_leads`. Editar a validade de um lead existente NÃO passa por aqui — o
// estágio de quem já está na base não muda por efeito colateral.
import type { WorkspaceConfig } from '../config/workspaceConfig'

export const ESTAGIO_RENOVACAO = 'renovacao'
export const ESTAGIO_INICIAL_PADRAO = 'novos_leads'

// Estágios de entrada/primeiro contato que o script de correção pode
// reclassificar como renovação. Qualquer estágio comercial posterior
// (follow_up, respondeu, interessado, perdido…) é preservado: um cliente movido
// para acompanhamento não volta para renovação se o script rodar de novo.
export const ESTAGIOS_RECLASSIFICAVEIS_RENOVACAO: readonly string[] = ['novos_leads', 'novo', 'primeiro_contato']

export function regraRenovacaoPorValidadeAtiva(cfg: WorkspaceConfig | null | undefined): boolean {
  return cfg?.features?.estagioRenovacaoPorValidade === true
}

export function temValidade(dataValidade: string | null | undefined): boolean {
  return typeof dataValidade === 'string' && dataValidade.trim() !== ''
}

export function estagioInicialLead(
  dataValidade: string | null | undefined,
  regraAtiva: boolean,
): typeof ESTAGIO_RENOVACAO | typeof ESTAGIO_INICIAL_PADRAO {
  return regraAtiva && temValidade(dataValidade) ? ESTAGIO_RENOVACAO : ESTAGIO_INICIAL_PADRAO
}
