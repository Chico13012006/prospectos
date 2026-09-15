// Interface de e-mail. Os fluxos só conhecem isto — nunca o Gmail diretamente.
// Hoje usamos o SimulatedProvider; amanhã um GmailProvider com a MESMA interface,
// sem mexer em nenhum fluxo.
import type { MensagemRecebida } from '../types'

// Arquivo anexado ao e-mail (ex.: PDF da proposta comercial).
export interface AnexoEmail {
  nomeArquivo: string
  conteudo: Uint8Array
  tipo: string // MIME, ex.: 'application/pdf'
}

export interface EmailProvider {
  // `html`, `cc` e `anexos` são OPCIONAIS e ADITIVOS: quando presentes, o
  // e-mail vai multipart (text=corpo como fallback + versão HTML), com cópia
  // e/ou com arquivos. Call sites antigos passam só o que já passavam. `cc`
  // coloca o comercial responsável em cópia nos envios de campanha e follow-ups
  // automáticos; `anexos` leva a proposta ao cliente.
  enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string, anexos?: AnexoEmail[]): Promise<void>
  lerCaixaEntrada(): Promise<MensagemRecebida[]>
  // Provedores reais podem adiar o \Seen até o fluxo concluir. Opcional para
  // preservar provedores simulados e integrações legadas.
  confirmarLeitura?(mensagens?: MensagemRecebida[]): Promise<void>
}
