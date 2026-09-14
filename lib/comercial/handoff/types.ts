// Domínio do HANDOFF COMERCIAL (Fase 1): tipos e estados.
//
// Handoff = momento em que um lead que virou oportunidade é entregue a um
// comercial. A fonte da verdade é o banco (tabela comercial_handoffs, migration
// 0041); aviso no grupo, prazo de 7 dias, retorno ao follow-up etc. são fases
// seguintes que CONSOMEM este registro — nunca o definem.
//
// Responsável ATUAL do lead continua em leads.responsavel_id (→ usuarios).
// Responsável HISTÓRICO (o que a reativação preserva) vem dos registros de
// handoff — só ownership que nasceu deste fluxo conta como histórico.

// Tipo de entrada no handoff. Fase 1 só recebe chamadas diretas (a fase
// seguinte liga a resposta positiva); os outros valores existem para que a
// arquitetura já distinga as origens futuras sem migration.
//   prospeccao   — lead da cadência automática que respondeu positivamente
//   hubspot_novo — lead novo do HubSpot sem responsável (futuro)
//   manual       — acionado por um humano na UI (futuro)
// Lead importado do HubSpot só para follow-up (tipo C) NÃO chama o handoff.
export const ORIGENS_HANDOFF = ['prospeccao', 'hubspot_novo', 'manual'] as const
export type OrigemHandoff = (typeof ORIGENS_HANDOFF)[number]

export function origemHandoffValida(x: unknown): x is OrigemHandoff {
  return typeof x === 'string' && (ORIGENS_HANDOFF as readonly string[]).includes(x)
}

// Como o responsável foi escolhido.
//   round_robin — próximo comercial participante do rodízio (avança o cursor)
//   reativacao  — o lead já teve comercial por handoff; preserva (não avança)
export type MotivoHandoff = 'round_robin' | 'reativacao'

// Estado comercial representado nesta fase. Não é leads.estagio: a cadência
// continua dona do estágio até a fase que a encerra automaticamente.
export type StatusHandoff = 'aguardando_distribuicao' | 'em_contato_comercial'

export const ROTULO_STATUS_HANDOFF: Record<StatusHandoff, string> = {
  aguardando_distribuicao: 'Aguardando distribuição',
  em_contato_comercial: 'Em contato comercial',
}

// Um comercial da organização e se participa do rodízio. `participa=false`
// (férias) tira dos PRÓXIMOS ciclos; não mexe nos leads que ele já tem.
export interface ComercialParticipante {
  usuarioId: string
  nome: string
  email: string | null
  participa: boolean
}

// Cursor do rodízio de uma organização. `ultimoUsuarioId` = último comercial
// que recebeu lead por round-robin (null = nunca rodou); `versao` é o número
// que o compare-and-swap do banco confere ao confirmar.
export interface CursorDistribuicao {
  ultimoUsuarioId: string | null
  versao: number
}

// Registro do handoff (linha de comercial_handoffs).
export interface RegistroHandoff {
  id: string
  organizacaoId: string
  leadId: string
  eventoId: string
  origem: string
  responsavelId: string | null
  motivo: MotivoHandoff | null
  primeiraAtribuicao: boolean | null
  status: StatusHandoff
  atribuidoEm: string | null
  encerradoEm: string | null
  // Fase 4: por que encerrou ('retorno_followup'). null enquanto aberto.
  encerradoMotivo: string | null
  criadoEm: string
}

// Motivos de encerramento conhecidos (texto livre no banco, tipado aqui).
export type MotivoEncerramentoHandoff = 'retorno_followup'

// Pedido de handoff. `eventoId` é a identidade do evento que originou (id da
// interação de resposta, id do objeto HubSpot…): processar o mesmo evento duas
// vezes devolve o mesmo registro, sem consumir outro turno.
export interface EntradaHandoff {
  organizacaoId: string
  leadId: string
  eventoId: string
  origem: OrigemHandoff
}

// Resultado controlado do handoff. Nunca lança por regra de negócio — só por
// falha de infraestrutura (banco indisponível).
export type ResultadoHandoff =
  // Comercial atribuído agora (registro + cursor + lead gravados juntos).
  | { tipo: 'atribuido'; motivo: MotivoHandoff; primeiraAtribuicao: boolean; responsavel: { id: string; nome: string }; handoff: RegistroHandoff }
  // Nenhum comercial participante/ativo: registro pendente, lead recuperável.
  | { tipo: 'aguardando_distribuicao'; handoff: RegistroHandoff }
  // Mesmo evento já concluído antes — idempotente, nada muda.
  | { tipo: 'ja_processado'; handoff: RegistroHandoff }
  // Outro evento, mas o lead já está em contato comercial — não redistribui.
  | { tipo: 'ja_em_contato_comercial'; handoff: RegistroHandoff }
  // Lead não existe NESTA organização.
  | { tipo: 'lead_nao_encontrado' }
  // Esgotou as tentativas de confirmar sob concorrência (raríssimo; nada gravado).
  | { tipo: 'conflito_concorrencia' }
