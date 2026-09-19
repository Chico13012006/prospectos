// Efeito de UM envio de PROSPECÇÃO sobre o lead. Módulo PURO (sem banco),
// análogo a lib/leads/estagioInicial.ts: a regra de negócio fica isolada e
// testável, e quem grava (lib/workflows/ambiente.ts) só aplica a decisão.
//
// Reusa o vocabulário e a máquina de estados do MOTOR LEGADO
// (lib/engine/templates.ts) de propósito: "1º contato" e "follow-up" precisam
// significar a MESMA coisa nos dois motores, senão um lead prospectado por
// campanha fica invisível para o legado (e vice-versa) — ver
// lib/campanhas/prospeccaoAutomatica.ts e o gap "G5" do diagnóstico que
// motivou esta entrega.
//
// Escopo: usado SOMENTE quando a campanha do envio é tipo='prospeccao'
// (gate aplicado em lib/workflows/ambiente.ts). Renovação e os demais tipos de
// campanha continuam gravando a interação como 'nota' e não tocam em
// estagio/followups_enviados — comportamento intencionalmente preservado.
import { tipoDoEnvio, proximoEstagio } from '@/lib/engine/templates'
import type { Estagio, TipoInteracaoEngine } from '@/lib/engine/types'

// Estrutural, de propósito — não usa `Pick<Lead, ...>`: o tipo `Lead`
// (lib/engine/types.ts -> lib/supabase.ts) não declara `optout` e sua união de
// `estagio` não inclui 'descartado', embora ambos sejam colunas/valores REAIS
// e já usados em produção (app/api/optout/route.ts, lib/campanhas/publicoServidor.ts).
// `estagio` é texto livre no banco (sem CHECK constraint) — ver AGENTS.md.
export interface LeadEstadoEnvio {
  optout?: boolean | null
  bounced?: boolean | null
  perdido?: boolean | null
  estagio?: string | null
}

// Estados que impedem QUALQUER envio automático de prospecção, mesmo que a
// execução do workflow já estivesse em andamento quando o estado mudou
// (opt-out/bounce/perdido no meio da cadência). 'descartado' cobre o caso de
// o estágio ter sido movido por outro caminho sem a flag optout.
export function leadBloqueadoParaEnvioProspeccao(
  lead: LeadEstadoEnvio | null | undefined,
): boolean {
  return !lead
    || lead.optout === true
    || lead.bounced === true
    || lead.perdido === true
    || lead.estagio === 'descartado'
}

export interface EfeitoEnvioProspeccao {
  // Tipo de interação a registrar — determina o que a Cadência e o motor
  // legado enxergam como "já enviado" para este lead.
  tipoInteracao: Extract<TipoInteracaoEngine, 'abordagem' | 'follow_up'>
  // Subconjunto de Estagio que proximoEstagio() de fato produz para as
  // entradas usadas aqui ('primeiro_contato' | 'follow_up') — é o mesmo tipo
  // que Partial<Lead>.estagio aceita, sem precisar de cast no call site.
  estagioDestino: Estagio
  followupsEnviados: number
}

// Decide o efeito de um envio de prospecção bem-sucedido, a partir do estado
// do lead ANTES deste envio (estágio + cache de followups_enviados).
export function efeitoEnvioProspeccao(
  estagioAntes: string,
  followupsEnviadosAntes: number,
): EfeitoEnvioProspeccao {
  const tipoInteracao = tipoDoEnvio(estagioAntes)
  return {
    tipoInteracao,
    estagioDestino: proximoEstagio(estagioAntes),
    // O cache (migration 0003) conta só follow-ups — o 1º contato não incrementa,
    // igual ao motor legado (lib/engine/flows/executarAcao.ts).
    followupsEnviados: tipoInteracao === 'follow_up' ? followupsEnviadosAntes + 1 : followupsEnviadosAntes,
  }
}
