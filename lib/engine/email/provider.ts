// Interface de e-mail. Os fluxos só conhecem isto — nunca o Gmail diretamente.
// Hoje usamos o SimulatedProvider; amanhã um GmailProvider com a MESMA interface,
// sem mexer em nenhum fluxo.
import type { MensagemRecebida } from '../types'

export interface EmailProvider {
  enviar(para: string, assunto: string, corpo: string): Promise<void>
  lerCaixaEntrada(): Promise<MensagemRecebida[]>
}
