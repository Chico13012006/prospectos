// Interface de e-mail. Os fluxos só conhecem isto — nunca o Gmail diretamente.
// Hoje usamos o SimulatedProvider; amanhã um GmailProvider com a MESMA interface,
// sem mexer em nenhum fluxo.
import type { MensagemRecebida } from '../types'

export interface EmailProvider {
  // `html` e `cc` são OPCIONAIS e ADITIVOS: quando presentes, o e-mail vai
  // multipart (text=corpo como fallback + versão HTML) e/ou com cópia. Call
  // sites antigos passam só o que já passavam. `cc` é usado hoje só no follow-up
  // automático (lib/engine/flows/followUp.ts) para colocar o comercial
  // responsável em cópia.
  enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string): Promise<void>
  lerCaixaEntrada(): Promise<MensagemRecebida[]>
}
