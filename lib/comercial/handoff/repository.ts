// Contrato de acesso a dados do handoff. O serviço decide sobre o que lê aqui e
// confirma via `confirmar()` — a única escrita que atribui, e ela é ATÔMICA
// (registro + cursor + lead numa transação; ver comercial_handoff_confirmar na
// migration 0041). Toda operação é escopada por organizacao_id explicitamente.
//
// Implementações: supabaseRepository.ts (produção, service_role) e o fake em
// memória dos testes (mesmas regras de confirmação, para provar o serviço).
import type {
  ComercialParticipante,
  CursorDistribuicao,
  EntradaHandoff,
  MotivoEncerramentoHandoff,
  MotivoHandoff,
  RegistroHandoff,
} from './types'

export interface LeadHandoffView {
  id: string
  responsavelId: string | null
  // Identificação do lead para mensagens (check-in): podem vir vazios.
  empresa: string
  contatoNome: string
}

// O que o lead já teve de handoff — base da regra de reativação.
export interface HistoricoHandoffLead {
  // Algum handoff anterior chegou a atribuir um comercial (mesmo que ele
  // tenha saído da equipe depois). Define `primeiraAtribuicao`.
  jaTeveAtribuicao: boolean
  // Responsável do handoff mais recente que ainda existe ATIVO nesta org —
  // é ele que a reativação preserva (mesmo fora do rodízio). null quando
  // nunca houve, ou quando o usuário foi removido/desativado.
  responsavelPreservavel: { usuarioId: string; nome: string } | null
}

// A decisão que o serviço tomou e quer confirmar.
export interface DecisaoHandoff {
  responsavelId: string | null           // null → aguardando_distribuicao
  motivo: MotivoHandoff | null
  primeiraAtribuicao: boolean | null
  cursorVersaoEsperada: number | null    // só round_robin (compare-and-swap)
}

// Espelho do jsonb devolvido por comercial_handoff_confirmar().
export type ResultadoConfirmacao =
  | { resultado: 'confirmado' | 'aguardando_distribuicao' | 'ja_processado' | 'ja_em_contato_comercial'; handoff: RegistroHandoff }
  | { resultado: 'lead_nao_encontrado' | 'participante_inelegivel' | 'conflito_cursor' }

export interface HandoffRepository {
  buscarLead(organizacaoId: string, leadId: string): Promise<LeadHandoffView | null>
  buscarHandoffAberto(organizacaoId: string, leadId: string): Promise<RegistroHandoff | null>
  buscarHistorico(organizacaoId: string, leadId: string): Promise<HistoricoHandoffLead>
  // Comerciais ATIVOS da org com a flag de participação (ausente = não participa).
  // Serve à tela de Configurações e ao rodízio (que só considera participa=true).
  listarDistribuicao(organizacaoId: string): Promise<ComercialParticipante[]>
  lerCursor(organizacaoId: string): Promise<CursorDistribuicao>
  confirmar(entrada: EntradaHandoff, decisao: DecisaoHandoff): Promise<ResultadoConfirmacao>
  // Configuração: liga/desliga a participação de um comercial da org.
  definirParticipacao(organizacaoId: string, usuarioId: string, participa: boolean): Promise<'ok' | 'usuario_nao_encontrado'>
  // Acompanhamento (Fase 3): handoffs ABERTOS (encerrado_em null, em contato
  // comercial, com responsável), mais antigos primeiro. O serviço decide quais
  // já venceram a janela e quando o próximo vence (para o scheduler dormir).
  listarAbertos(organizacaoId: string, limite: number): Promise<RegistroHandoff[]>
  // Fase 4: um handoff por id (na org) e o encerramento idempotente
  // (só fecha o que está aberto; 'ja_encerrado' quando já tinha encerrado_em).
  buscarHandoff(organizacaoId: string, handoffId: string): Promise<RegistroHandoff | null>
  encerrar(organizacaoId: string, handoffId: string, motivo: MotivoEncerramentoHandoff): Promise<'encerrado' | 'ja_encerrado' | 'nao_encontrado'>
}
