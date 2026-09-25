// Número digitado no formato brasileiro ("1.500,50", "1500,5", "45").
// Puro — usado em formulários de Configurações e nos testes.

/**
 * Converte o texto em número. Com vírgula, ela é o decimal e os pontos são
 * milhar; sem vírgula, ponto seguido de grupos de 3 dígitos é milhar
 * ("1.500") e, fora isso, ponto é decimal ("4.5"). Vazio devolve null.
 */
export function lerNumeroBr(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '')
  if (!t) return null
  let normal: string
  if (t.includes(',')) {
    if (t.indexOf(',') !== t.lastIndexOf(',')) return NaN
    normal = t.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    normal = t.replace(/\./g, '')
  } else {
    normal = t
  }
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}
