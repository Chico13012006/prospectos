// Interface de e-mail. Os fluxos só conhecem isto — nunca o Gmail diretamente.
// Hoje usamos o SimulatedProvider; amanhã um GmailProvider com a MESMA interface,
// sem mexer em nenhum fluxo.
import type { MensagemRecebida } from '../types'

export interface EmailProvider {
  // `html` e `cc` são OPCIONAIS e ADITIVOS: quando presentes, o e-mail vai
  // multipart (text=corpo como fallback + versão HTML) e/ou com cópia. Call
  // sites antigos passam só o que já passavam. `cc` coloca o comercial
  // responsável em cópia nos envios de campanha e follow-ups automáticos.
  enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string): Promise<void>
  lerCaixaEntrada(): Promise<MensagemRecebida[]>
  // Provedores reais podem adiar o \Seen até o fluxo concluir. Opcional para
  // preservar provedores simulados e integrações legadas.
  confirmarLeitura?(mensagens?: MensagemRecebida[]): Promise<void>
}
