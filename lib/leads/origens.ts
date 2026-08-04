// Opções de ORIGEM do lead (2.1). O seletor padroniza as fontes mais comuns — o
// que melhora a análise por canal/origem na Inteligência Comercial depois — mas
// o valor salvo em leads.origem continua sendo TEXTO LIVRE: o seletor não trava
// o campo, só sugere. "Outro" abre um campo de texto; o valor gravado é o texto
// digitado (ou "Outro" se ficar vazio).
export const ORIGENS = [
  'LinkedIn',
  'Indicação',
  'Lista fria (cold list)',
  'Evento',
  'Pesquisa própria',
  'Site',
  'Outro',
] as const

export const ORIGEM_OUTRO = 'Outro'
