// Interface de e-mail. Os fluxos só conhecem isto — nunca o Gmail diretamente.
// Hoje usamos o SimulatedProvider; amanhã um GmailProvider com a MESMA interface,
// sem mexer em nenhum fluxo.
import type { MensagemRecebida } from '../types'

export interface EmailProvider {
  // `html` é OPCIONAL e ADITIVO: quando presente, o e-mail vai multipart
  // (text=corpo como fallback + versão HTML). Call sites antigos passam só texto.
  enviar(para: string, assunto: string, corpo: string, html?: string): Promise<void>
  lerCaixaEntrada(): Promise<MensagemRecebida[]>
}
