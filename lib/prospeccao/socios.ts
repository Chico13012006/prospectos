// Quadro societário via OpenCNPJ (grátis, sem chave, consulta CNPJ a CNPJ).
// Usado no passo "analisar": sugere o decisor. A OpenCNPJ mascara o CPF.

export interface Socio {
  nome: string
  qualificacao: string
  desde: string | null
}

interface QsaOpenCnpj {
  nome_socio?: string
  qualificacao_socio?: string
  data_entrada_sociedade?: string
  identificador_socio?: string
}

function titulo(s: string): string {
  const minusculas = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

export function mapearSocios(qsa: unknown): Socio[] {
  if (!Array.isArray(qsa)) return []
  return (qsa as QsaOpenCnpj[])
    // Sócio pessoa jurídica (holding) não é quem responde e-mail.
    .filter((s) => typeof s?.nome_socio === 'string' && s.nome_socio.trim() && !/jur[ií]dica/i.test(s.identificador_socio ?? ''))
    .map((s) => ({
      nome: titulo(s.nome_socio!.trim()),
      qualificacao: (s.qualificacao_socio ?? '').trim() || 'Sócio',
      desde: /^\d{4}-\d{2}-\d{2}$/.test(s.data_entrada_sociedade ?? '') ? s.data_entrada_sociedade! : null,
    }))
}

/** Administrador primeiro; depois sócio/titular; senão o primeiro da lista. */
export function sugerirDecisor(socios: Socio[]): Socio | null {
  return (
    socios.find((s) => /adminis/i.test(s.qualificacao)) ??
    socios.find((s) => /s[óo]cio|titular|empres[áa]rio|diretor|presidente/i.test(s.qualificacao)) ??
    socios[0] ??
    null
  )
}

const TIMEOUT_MS = 8000

export async function consultarSocios(
  cnpj: string,
  fetcher: typeof fetch = fetch
): Promise<{ ok: true; socios: Socio[] } | { ok: false; motivo: 'nao_encontrado' | 'indisponivel' }> {
  if (!/^\d{14}$/.test(cnpj)) return { ok: false, motivo: 'nao_encontrado' }
  try {
    const res = await fetcher(`https://api.opencnpj.org/${cnpj}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 404) return { ok: false, motivo: 'nao_encontrado' }
    if (!res.ok) return { ok: false, motivo: 'indisponivel' }
    const dados = (await res.json()) as { QSA?: unknown }
    return { ok: true, socios: mapearSocios(dados.QSA) }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  }
}
