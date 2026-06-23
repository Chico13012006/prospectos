// Provedor de e-mail SIMULADO — o coração do MODO_ENSAIO.
// Não envia nada de verdade: apenas registra o que faria. A caixa de entrada
// pode ser pré-carregada (útil para testes e demonstração do Fluxo 2).
import type { EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { log } from '../logger'

export class SimulatedProvider implements EmailProvider {
  private caixa: MensagemRecebida[]
  public readonly enviados: { para: string; assunto: string; corpo: string }[] = []

  constructor(caixaEntrada: MensagemRecebida[] = []) {
    this.caixa = caixaEntrada
  }

  async enviar(para: string, assunto: string, corpo: string): Promise<void> {
    this.enviados.push({ para, assunto, corpo })
    log.info('[ENSAIO] e-mail NÃO enviado (simulado)', {
      para,
      assunto,
      previa: corpo.slice(0, 120),
    })
  }

  async lerCaixaEntrada(): Promise<MensagemRecebida[]> {
    // Entrega e esvazia (cada mensagem é processada uma vez).
    const msgs = this.caixa
    this.caixa = []
    return msgs
  }

  // Helper para testes/demo: injeta mensagens na caixa.
  injetar(...msgs: MensagemRecebida[]) {
    this.caixa.push(...msgs)
  }
}
