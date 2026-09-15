// Provedor de e-mail SIMULADO — o coração do MODO_ENSAIO.
// Não envia nada de verdade: apenas registra o que faria. A caixa de entrada
// pode ser pré-carregada (útil para testes e demonstração do Fluxo 2).
import type { AnexoEmail, EmailProvider } from './provider'
import type { MensagemRecebida } from '../types'
import { log } from '../logger'

export class SimulatedProvider implements EmailProvider {
  private caixa: MensagemRecebida[]
  public readonly enviados: { para: string; assunto: string; corpo: string; html?: string; cc?: string; anexos?: string[] }[] = []

  constructor(caixaEntrada: MensagemRecebida[] = []) {
    this.caixa = caixaEntrada
  }

  async enviar(para: string, assunto: string, corpo: string, html?: string, cc?: string, anexos?: AnexoEmail[]): Promise<void> {
    // Anexos entram só pelo nome (o conteúdo não interessa à simulação).
    const nomesAnexos = anexos?.length ? { anexos: anexos.map((a) => a.nomeArquivo) } : {}
    this.enviados.push({ para, assunto, corpo, html, cc, ...nomesAnexos })
    log.info('[ENSAIO] e-mail NÃO enviado (simulado)', {
      para,
      assunto,
      cc,
      ...nomesAnexos,
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
