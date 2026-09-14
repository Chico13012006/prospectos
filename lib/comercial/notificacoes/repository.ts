// Contrato de acesso ao outbox de notificações do handoff. Toda operação é
// escopada por organizacao_id. A escrita que importa para a idempotência é
// `reivindicarEnvio`: compare-and-swap em `tentativas` — só quem vence a troca
// pendente→enviando envia; concorrentes recebem false e não tocam o provedor.
import type { DadosAlertaHandoff, NotificacaoHandoff, TipoNotificacaoHandoff } from './types'

// Colisão do código curto (índice único por org): quem chama sorteia outro.
// Vive no contrato (sem server-only) para o serviço e os fakes a reconhecerem.
export class CodigoRefEmUsoError extends Error {}

export interface NotificacaoHandoffRepository {
  // Insere a intenção se não existir (unique handoff+tipo). Devolve a linha
  // existente quando já havia — nunca duplica.
  registrarIntencao(
    organizacaoId: string,
    handoffId: string,
    tipo: TipoNotificacaoHandoff,
    dados: DadosAlertaHandoff,
    opcoes?: { codigoRef?: string },
  ): Promise<NotificacaoHandoff>
  // Fase 4: correlação comando → check-in. null = código desconhecido nesta org.
  buscarPorCodigo(organizacaoId: string, codigoRef: string): Promise<NotificacaoHandoff | null>
  buscar(organizacaoId: string, id: string): Promise<NotificacaoHandoff | null>
  // pendente|falhou|configuracao_ausente + tentativas == esperadas → enviando,
  // tentativas+1. false = outro processo já reivindicou (ou estado mudou).
  reivindicarEnvio(organizacaoId: string, id: string, tentativasEsperadas: number): Promise<boolean>
  marcarEnviada(organizacaoId: string, id: string, info: { destino: string; providerMessageId: string | null }): Promise<void>
  marcarFalha(organizacaoId: string, id: string, erro: string): Promise<void>
  marcarConfiguracaoAusente(organizacaoId: string, id: string, erro: string): Promise<void>
  // Candidatas a reprocessar: não enviadas, não presas em 'enviando', abaixo do teto.
  listarReprocessaveis(organizacaoId: string, tetoTentativas: number, limite: number): Promise<NotificacaoHandoff[]>
  // Intenções já existentes de um tipo para um conjunto de handoffs (o
  // acompanhamento usa para não reprocessar check-ins já enviados/esgotados).
  listarPorHandoffs(organizacaoId: string, tipo: TipoNotificacaoHandoff, handoffIds: string[]): Promise<NotificacaoHandoff[]>
}
