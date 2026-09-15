// Edição das mensagens de uma campanha já publicada. Regras puras e client-safe:
// a rota impõe e a tela usa para avisar antes de salvar.
//
// Pode mudar: assunto, texto, HTML e link de cada mensagem, e o aviso ao
// responsável. Não muda: quantidade de mensagens, intervalos e os campos
// materializados (templateTipo, templateId, ids de ação) — é por eles que a
// versão publicada do workflow encontra cada mensagem. O conteúdo é lido na
// hora de cada envio, então a edição vale para os próximos e-mails; o que já
// saiu fica como foi.
import { LIMITE_HTML_CAMPANHA, corpoComLink, urlPermitida } from './configuracaoGuiada'

// Espelham `preencher` (lib/engine/mensagem.ts) e o aviso do Fluxo 3
// (lib/engine/flows/direcionarCloser.ts). Ambos aceitam {x} e {{x}}.
export const VARIAVEIS_MENSAGEM_CAMPANHA = [
  'nome', 'empresa', 'segmento', 'cidade', 'responsavel_comercial', 'data_validade', 'nome_servico',
] as const

export const VARIAVEIS_AVISO_RESPOSTA = [
  'empresa', 'contato', 'nome_cliente', 'email_contato', 'nicho', 'score',
  'resposta', 'resposta_cliente', 'campanha', 'tipo_campanha', 'responsavel',
] as const

export interface MensagemEditada {
  assunto: string
  corpo: string
  html?: string
  link?: string
}

export interface MensagemParaTemplate {
  indice: number
  templateTipo: string
  assunto: string
  corpo: string
}

type Objeto = Record<string, unknown>

const objeto = (valor: unknown): Objeto =>
  valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Objeto : {}

const texto = (valor: unknown): string | undefined =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : undefined

const bytes = (valor: string) => new TextEncoder().encode(valor).byteLength

const semIndefinidos = (obj: Objeto): Objeto =>
  Object.fromEntries(Object.entries(obj).filter(([, valor]) => valor !== undefined))

export function rotuloMensagem(indice: number): string {
  return indice === 0 ? 'da mensagem inicial' : `do follow-up ${indice}`
}

export function motivoBloqueioEdicaoMensagens(status: string | null | undefined): string | null {
  if (status === 'ativa' || status === 'pausada') return null
  if (status === 'rascunho') return 'Edite as mensagens do rascunho no assistente da campanha.'
  if (status === 'concluida') return 'Campanha concluída é somente leitura.'
  return 'O status desta campanha não permite editar mensagens.'
}

// Variáveis escritas que o envio não sabe preencher — apareceriam literais no
// e-mail. Chaves com espaço ou dois-pontos (CSS) não contam como variável.
export function variaveisDesconhecidas(conteudo: string | null | undefined, conhecidas: readonly string[]): string[] {
  if (!conteudo) return []
  const validas = new Set(conhecidas)
  const encontradas = new Set<string>()
  for (const [, dupla, simples] of conteudo.matchAll(/\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g)) {
    const chave = dupla ?? simples
    if (chave && !validas.has(chave)) encontradas.add(chave)
  }
  return [...encontradas]
}

function editarMensagem(atual: Objeto, bruto: unknown, indice: number): Objeto {
  const edicao = objeto(bruto)
  const rotulo = rotuloMensagem(indice)
  const assunto = texto(edicao.assunto)
  const corpo = texto(edicao.corpo)
  const html = texto(edicao.html)
  const link = texto(edicao.link)
  if (!assunto) throw new Error(`Informe o assunto ${rotulo}.`)
  if (!corpo) throw new Error(`Escreva o texto ${rotulo}.`)
  if (html && bytes(html) > LIMITE_HTML_CAMPANHA) throw new Error(`O HTML ${rotulo} excede 200 KB.`)
  if (!urlPermitida(link)) throw new Error(`O link ${rotulo} precisa usar http ou https.`)

  const mensagem: Objeto = { ...atual, assunto, corpo, html, link }
  // HTML trocado à mão invalida os campos do modelo pronto: reabrir o
  // formulário do modelo regeraria o HTML antigo por cima do novo.
  if ((texto(atual.html) ?? '') !== (html ?? '')) {
    mensagem.modeloId = undefined
    mensagem.modeloCampos = undefined
  }
  return semIndefinidos(mensagem)
}

function editarAviso(atual: Objeto, bruto: unknown): Objeto {
  const edicao = objeto(bruto)
  const emailAssunto = texto(edicao.emailAssunto)
  const emailCorpo = texto(edicao.emailCorpo)
  const emailHtml = texto(edicao.emailHtml)
  if (atual.notificarResponsavel !== false) {
    if (!emailAssunto) throw new Error('Informe o assunto do aviso ao responsável.')
    if (!emailCorpo) throw new Error('Escreva o texto do aviso ao responsável.')
  }
  if (emailHtml && bytes(emailHtml) > LIMITE_HTML_CAMPANHA) {
    throw new Error('O HTML do aviso ao responsável excede 200 KB.')
  }
  return semIndefinidos({ ...atual, emailAssunto, emailCorpo, emailHtml })
}

// Aplica a edição sobre o `publico` gravado sem renormalizá-lo: só os campos de
// conteúdo são substituídos, todo o resto do jsonb segue como estava.
export function aplicarEdicaoMensagens(
  publicoAtual: unknown,
  edicaoBruta: unknown,
): { publico: Objeto; templates: MensagemParaTemplate[] } {
  const publico = objeto(publicoAtual)
  const operacao = objeto(publico.operacao)
  const edicao = objeto(edicaoBruta)
  const followupsAtuais = Array.isArray(operacao.followups) ? operacao.followups.map(objeto) : []
  const followupsEditados = Array.isArray(edicao.followups) ? edicao.followups : []
  if (followupsEditados.length !== followupsAtuais.length) {
    throw new Error('A quantidade de mensagens de uma campanha publicada não pode mudar.')
  }

  const atuais = [objeto(operacao.mensagemInicial), ...followupsAtuais]
  const editadas: unknown[] = [edicao.mensagemInicial, ...followupsEditados]
  const templates: MensagemParaTemplate[] = []
  const novas = atuais.map((atual, indice) => {
    const templateTipo = texto(atual.templateTipo)
    if (!templateTipo) {
      throw new Error(`Não há template publicado ${rotuloMensagem(indice)}; edite pelo assistente da campanha.`)
    }
    const mensagem = editarMensagem(atual, editadas[indice], indice)
    templates.push({
      indice,
      templateTipo,
      assunto: mensagem.assunto as string,
      corpo: corpoComLink({ corpo: mensagem.corpo as string, link: mensagem.link as string | undefined }),
    })
    return mensagem
  })

  const proximaOperacao: Objeto = { ...operacao, mensagemInicial: novas[0] }
  if (followupsAtuais.length) proximaOperacao.followups = novas.slice(1)
  if (edicao.resposta !== undefined) proximaOperacao.resposta = editarAviso(objeto(operacao.resposta), edicao.resposta)
  return { publico: { ...publico, operacao: proximaOperacao }, templates }
}
