// Chave canônica compartilhada entre importação, templates e motor.
// Mantém a taxonomia aberta: qualquer nicho informado vira uma chave estável,
// enquanto sinônimos comuns convergem para o mesmo valor.
const SINONIMOS_NICHO: Record<string, string> = {
  otica: 'oticas',
  relojoaria: 'oticas',
  hotel: 'hotelaria',
  hoteis: 'hotelaria',
  turismo: 'hotelaria',
  comercio: 'varejo',
  loja: 'varejo',
  lojas: 'varejo',
  saude: 'hospital',
  hospitalar: 'hospital',
  clinica: 'hospital',
  industrial: 'industria',
  manufatura: 'industria',
  fabrica: 'industria',
  alimenticio: 'alimentos',
  alimenticia: 'alimentos',
  bebidas: 'alimentos',
}

function canonizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function normalizarNicho(valor?: string | null): string | null {
  if (!valor) return null
  const chave = canonizar(valor)
  if (!chave) return null
  return SINONIMOS_NICHO[chave] ?? chave
}
