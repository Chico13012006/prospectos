// Operadores do filtro de público genérico (Fase 4.5, entrega 1). Lógica PURA
// (sem I/O) para ser testável isolada: dado o valor de um campo do lead, o
// operador e o valor esperado, diz se a condição passa.
//
// A condição `campo` (blocos.ts) só faz: ler o campo do lead (via ambiente,
// whitelist) e delegar a comparação para cá. Assim a matriz de operadores é
// testada sem banco.

export type Operador =
  | 'igual'
  | 'diferente'
  | 'maior_que'
  | 'menor_que'
  | 'contem'
  | 'vazio'
  | 'nao_vazio'
  | 'ha_mais_de_dias'

// Metadados p/ a UI (rótulo + se o operador usa o campo "valor").
export const OPERADORES: { valor: Operador; label: string; usaValor: boolean }[] = [
  { valor: 'igual', label: 'é igual a', usaValor: true },
  { valor: 'diferente', label: 'é diferente de', usaValor: true },
  { valor: 'maior_que', label: 'é maior que', usaValor: true },
  { valor: 'menor_que', label: 'é menor que', usaValor: true },
  { valor: 'contem', label: 'contém', usaValor: true },
  { valor: 'vazio', label: 'está vazio', usaValor: false },
  { valor: 'nao_vazio', label: 'não está vazio', usaValor: false },
  { valor: 'ha_mais_de_dias', label: 'há mais de (dias)', usaValor: true },
]

const ehVazio = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

// Ordena a vs b como números (se ambos numéricos) ou como datas (se ambos
// parseáveis). Retorna -1/0/1, ou null se não há ordem sensata (comparar texto
// livre por > não faz sentido). Empty string não vira 0 numérico.
function comparar(a: unknown, b: unknown): number | null {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  if (sa !== '' && sb !== '') {
    const na = Number(sa)
    const nb = Number(sb)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return Math.sign(na - nb)
    const da = Date.parse(sa)
    const db = Date.parse(sb)
    if (!Number.isNaN(da) && !Number.isNaN(db)) return Math.sign(da - db)
  }
  return null
}

// Igualdade: numérica/data se comparáveis; senão texto case-insensitive.
function saoIguais(a: unknown, b: unknown): boolean {
  const c = comparar(a, b)
  if (c !== null) return c === 0
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

export function avaliarOperador(
  operador: Operador,
  valorCampo: unknown,
  valorEsperado?: unknown,
  agoraISO: string = new Date().toISOString(),
): boolean {
  switch (operador) {
    case 'vazio':
      return ehVazio(valorCampo)
    case 'nao_vazio':
      return !ehVazio(valorCampo)
    case 'igual':
      return saoIguais(valorCampo, valorEsperado)
    case 'diferente':
      return !saoIguais(valorCampo, valorEsperado)
    case 'maior_que': {
      const c = comparar(valorCampo, valorEsperado)
      return c !== null && c > 0
    }
    case 'menor_que': {
      const c = comparar(valorCampo, valorEsperado)
      return c !== null && c < 0
    }
    case 'contem':
      if (ehVazio(valorCampo)) return false
      return String(valorCampo).toLowerCase().includes(String(valorEsperado ?? '').toLowerCase())
    case 'ha_mais_de_dias': {
      const t = Date.parse(String(valorCampo))
      const dias = Number(valorEsperado)
      if (Number.isNaN(t) || Number.isNaN(dias)) return false
      const limite = new Date(agoraISO).getTime() - dias * 86_400_000
      return t < limite
    }
    default:
      return false
  }
}
