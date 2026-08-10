// Normalização de CNPJ — fonte única. O índice único parcial de `empresas`
// (uq_empresas_cnpj_org, migration 0016) assume o valor JÁ normalizado (só
// dígitos), então toda escrita de CNPJ deve passar por aqui antes. Também é a
// base da deduplicação por CNPJ da Fase 2b.

// Devolve só os 14 dígitos do CNPJ, ou null se não houver um CNPJ plausível.
// Não valida os dígitos verificadores (dado importado costuma vir sujo/parcial);
// só garante forma canônica p/ igualdade. 14 dígitos exatos = aceita; caso
// contrário null (evita casar "parcial" com "parcial" por engano).
export function normalizarCnpj(bruto: unknown): string | null {
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return null
  const digitos = String(bruto).replace(/\D/g, '')
  return digitos.length === 14 ? digitos : null
}

// Formata um CNPJ normalizado para exibição (00.000.000/0000-00). Entrada
// inválida volta como veio (melhor mostrar algo que quebrar a tela).
export function formatarCnpj(bruto: unknown): string {
  const n = normalizarCnpj(bruto)
  if (!n) return typeof bruto === 'string' ? bruto : ''
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12)}`
}
