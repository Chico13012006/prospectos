// Classificação de uma resposta REAL de lead (já passou pelos filtros de
// auto-resposta/bounce do motor): ela demonstra interesse ou não?
//
// Hoje o motor trata qualquer resposta humana como "Respondeu". O handoff
// comercial precisa de mais: só resposta POSITIVA entrega o lead ao comercial e
// avisa o grupo. Decisão do Chico (13/09/2026): regras determinísticas para o
// que é inequívoco (recusa/opt-out) + IA (Haiku, saída estruturada) para o
// resto; IA indisponível → 'indeterminado' = SEM handoff (o motor segue
// pausando a cadência e avisando o closer como sempre fez).
//
// Este módulo é PURO na regra e injeta a IA — a implementação real (camada
// central lib/ia, provider por AI_PROVIDER) vive em ./classificadorIa.ts
// (server-only) e os testes usam um fake.

export type ClassificacaoResposta = 'positivo' | 'negativo' | 'neutro' | 'indeterminado'

export interface RespostaParaClassificar {
  assunto: string
  corpo: string
}

export interface ResultadoClassificacao {
  classificacao: ClassificacaoResposta
  // Como se chegou lá: regra determinística, IA, ou falha/ausência de IA.
  via: 'regra' | 'ia' | 'indisponivel'
  motivo?: string
}

// Classificador de IA: devolve positivo/negativo/neutro, ou null quando não
// consegue (indisponível, resposta inválida). NUNCA deve lançar.
export type ClassificadorIa = (resposta: RespostaParaClassificar) => Promise<Exclude<ClassificacaoResposta, 'indeterminado'> | null>

// Recusa/opt-out inequívocos. Só o que não deixa dúvida entra aqui: qualquer
// coisa ambígua ("não agora", "talvez depois") vai para a IA.
const PADROES_NEGATIVOS = [
  'não tenho interesse', 'nao tenho interesse', 'não temos interesse', 'nao temos interesse',
  'sem interesse', 'não há interesse', 'nao ha interesse',
  'não quero receber', 'nao quero receber', 'não desejo receber', 'nao desejo receber',
  'parem de enviar', 'pare de enviar', 'parar de receber', 'remova meu', 'remover meu',
  'me remova', 'me removam', 'descadastr', 'cancelar inscrição', 'cancelar inscricao',
  'unsubscribe', 'not interested', 'no interest', 'remove me', 'stop sending',
]

function normalizar(texto: string): string {
  return texto.toLowerCase().replace(/\s+/g, ' ').trim()
}

// Marcadores de início do HISTÓRICO CITADO numa resposta de e-mail. Cobrem o
// Gmail (pt-BR e inglês), o Outlook e os clientes que prefixam a citação com
// '>'. O primeiro que casar delimita onde o texto NOVO termina.
const MARCADORES_CITACAO: RegExp[] = [
  /^>/m, // linha citada (Gmail, Apple Mail, Thunderbird)
  /\bEm\s[\s\S]{0,300}?\bescreveu:/, // atribuição do Gmail pt-BR (quebra linha no meio)
  /\bOn\s[\s\S]{0,300}?\bwrote:/, // atribuição do Gmail em inglês
  /^\s*-{2,}\s*(Mensagem original|Original Message|Forwarded message)/im,
  /^_{10,}$/m, // separador do Outlook
]

/**
 * Texto que o lead REALMENTE escreveu agora, sem o histórico citado.
 *
 * Uma resposta carrega a mensagem original inteira embaixo, e essa mensagem é a
 * NOSSA — incluindo o rodapé de descadastro. Classificar o corpo inteiro faz o
 * nosso próprio "clique aqui para se descadastrar" casar com PADROES_NEGATIVOS:
 * em 19/09/2026 um "Top, tenho interesse" virou 'negativo' e o lead foi para
 * 'perdido', sem handoff. Sem marcador de citação, devolve o corpo inteiro.
 */
export function textoNovoDaResposta(corpo: string): string {
  let corte = corpo.length
  for (const marcador of MARCADORES_CITACAO) {
    const encontrado = corpo.match(marcador)
    if (encontrado?.index !== undefined && encontrado.index < corte) corte = encontrado.index
  }
  return corpo.slice(0, corte)
}

// Regra determinística: negativo inequívoco → 'negativo'; senão null (decide a IA).
// Recebe o texto já sem citação (ver classificarResposta).
export function classificarPorRegra(resposta: RespostaParaClassificar): 'negativo' | null {
  const alvo = normalizar(`${resposta.assunto}\n${resposta.corpo}`)
  if (!alvo) return null
  return PADROES_NEGATIVOS.some((p) => alvo.includes(p)) ? 'negativo' : null
}

/**
 * Classifica a resposta. Ordem: regra determinística → IA → indeterminado.
 * Nunca lança: qualquer falha da IA vira 'indeterminado' (não dispara handoff).
 *
 * Regra e IA enxergam SÓ o texto novo: o histórico citado é a mensagem que nós
 * enviamos e não diz nada sobre a intenção de quem respondeu.
 */
export async function classificarResposta(
  resposta: RespostaParaClassificar,
  ia: ClassificadorIa | null,
): Promise<ResultadoClassificacao> {
  const semCitacao: RespostaParaClassificar = {
    assunto: resposta.assunto,
    corpo: textoNovoDaResposta(resposta.corpo),
  }
  const porRegra = classificarPorRegra(semCitacao)
  if (porRegra) return { classificacao: porRegra, via: 'regra', motivo: 'recusa/opt-out explícito' }
  if (!normalizar(semCitacao.corpo)) return { classificacao: 'indeterminado', via: 'regra', motivo: 'corpo vazio' }
  if (!ia) return { classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA não configurada' }
  try {
    const r = await ia(semCitacao)
    if (r === 'positivo' || r === 'negativo' || r === 'neutro') return { classificacao: r, via: 'ia' }
    return { classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA sem resposta válida' }
  } catch (e) {
    return { classificacao: 'indeterminado', via: 'indisponivel', motivo: e instanceof Error ? e.message : String(e) }
  }
}
