// Notificações do handoff comercial (Fase 2). O handoff (comercial_handoffs)
// é a fonte da verdade; avisar o grupo é um EFEITO registrado num outbox
// próprio (comercial_handoff_notificacoes, migration 0042) — recuperável,
// idempotente por (handoff, tipo), com teto de tentativas.
import type { MotivoHandoff } from '../handoff/types'

//   grupo_comercial — aviso do handoff (Fase 2): "novo lead interessado"
//   handoff_checkin — acompanhamento (Fase 3): "@Bruno, como ficou o lead X?"
// Identidade única (handoff_id, tipo): um aviso e um check-in por handoff.
export type TipoNotificacaoHandoff = 'grupo_comercial' | 'handoff_checkin'

// pendente → enviando → enviada | falhou (retentável até o teto)
// configuracao_ausente: grupo não configurado na org (volta a tentar ao reprocessar)
// enviando "preso" (processo morreu entre o envio e a marcação) NÃO é reenviado
// sozinho: reenviar poderia duplicar a mensagem no grupo.
export type StatusNotificacaoHandoff = 'pendente' | 'enviando' | 'enviada' | 'falhou' | 'configuracao_ausente'

// Dados congelados no momento do handoff para montar a mensagem — reprocessar
// depois produz o MESMO texto, mesmo que o lead ou o responsável mudem.
export interface DadosAlertaHandoff {
  empresa: string
  contato: string
  responsavelNome: string
  motivo: MotivoHandoff
  // Etapa da cadência em que o lead respondeu: "primeiro contato", "follow-up 2",
  // 'campanha "X"'. Texto pronto para a mensagem.
  etapaCadencia: string
  // Só no check-in: "7 dias", "5 minutos"… calculado de atribuido_em no momento
  // em que a intenção é criada (congelado como o resto).
  tempoEmContato?: string
}

export interface NotificacaoHandoff {
  id: string
  organizacaoId: string
  handoffId: string
  tipo: TipoNotificacaoHandoff
  status: StatusNotificacaoHandoff
  tentativas: number
  ultimoErro: string | null
  dados: DadosAlertaHandoff
  destino: string | null
  providerMessageId: string | null
  enviadoEm: string | null
  criadoEm: string
  // Fase 4: referência curta impressa no check-in ("#A82F31"), única por org.
  // null nos avisos que não pedem resposta (grupo_comercial).
  codigoRef: string | null
}

// Porta de envio a grupo — a implementação real é lib/whatsapp/zapi.sendGroupText.
export type ResultadoEnvioGrupo =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; codigo: string; mensagem: string }

export type EnviadorGrupo = (grupoId: string, mensagem: string) => Promise<ResultadoEnvioGrupo>
