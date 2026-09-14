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
// Este módulo é PURO na regra e injeta a IA — a implementação Claude vive em
// ./classificadorIa.ts (server-only) e os testes usam um fake.

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

// Regra determinística: negativo inequívoco → 'negativo'; senão null (decide a IA).
export function classificarPorRegra(resposta: RespostaParaClassificar): 'negativo' | null {
  const alvo = normalizar(`${resposta.assunto}\n${resposta.corpo}`)
  if (!alvo) return null
  return PADROES_NEGATIVOS.some((p) => alvo.includes(p)) ? 'negativo' : null
}

/**
 * Classifica a resposta. Ordem: regra determinística → IA → indeterminado.
 * Nunca lança: qualquer falha da IA vira 'indeterminado' (não dispara handoff).
 */
export async function classificarResposta(
  resposta: RespostaParaClassificar,
  ia: ClassificadorIa | null,
): Promise<ResultadoClassificacao> {
  const porRegra = classificarPorRegra(resposta)
  if (porRegra) return { classificacao: porRegra, via: 'regra', motivo: 'recusa/opt-out explícito' }
  if (!normalizar(resposta.corpo)) return { classificacao: 'indeterminado', via: 'regra', motivo: 'corpo vazio' }
  if (!ia) return { classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA não configurada' }
  try {
    const r = await ia(resposta)
    if (r === 'positivo' || r === 'negativo' || r === 'neutro') return { classificacao: r, via: 'ia' }
    return { classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA sem resposta válida' }
  } catch (e) {
    return { classificacao: 'indeterminado', via: 'indisponivel', motivo: e instanceof Error ? e.message : String(e) }
  }
}
