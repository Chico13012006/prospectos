// Layout dos arquivos de dados abertos do CNPJ (Receita Federal).
// Módulo puro: recebe linhas CSV e devolve registros. Sem IO, para testar
// o parse sem baixar nada.
//
// Formato da RF: campos entre aspas, separados por ';', encoding latin1,
// datas 'AAAAMMDD', decimais com vírgula.

export interface Estabelecimento {
  cnpj: string
  cnpj_basico: string
  nome_fantasia: string | null
  cnae_principal: string
  cnaes_secundarios: string[]
  data_inicio_atividade: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  uf: string | null
  municipio_codigo: string | null
  telefone: string | null
  email: string | null
}

export interface Empresa {
  razao_social: string | null
  natureza_juridica: string | null
  capital_social: number | null
  porte: Porte | null
}

export type Porte = 'nao_informado' | 'micro' | 'pequeno' | 'demais'

const PORTES: Record<string, Porte> = { '00': 'nao_informado', '01': 'micro', '03': 'pequeno', '05': 'demais' }

// Estabelecimentos — posição dos campos no layout da RF.
const E = {
  basico: 0, ordem: 1, dv: 2, matrizFilial: 3, fantasia: 4, situacao: 5,
  inicioAtividade: 10, cnaePrincipal: 11, cnaesSecundarios: 12,
  tipoLogradouro: 13, logradouro: 14, numero: 15, complemento: 16, bairro: 17,
  cep: 18, uf: 19, municipio: 20, ddd1: 21, tel1: 22, email: 27,
} as const
const E_MIN_CAMPOS = 28

const MATRIZ = '1'
const SITUACAO_ATIVA = '02'

export function parseLinhaCsv(linha: string): string[] {
  const s = linha.trim()
  if (!s) return []
  return s.replace(/^"/, '').replace(/"$/, '').split('";"')
}

function texto(v: string | undefined): string | null {
  const t = (v ?? '').trim().replace(/\s+/g, ' ')
  return t ? t : null
}

export function parseData(v: string | undefined): string | null {
  const t = (v ?? '').trim()
  if (!/^\d{8}$/.test(t) || t === '00000000') return null
  const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

export function parseDecimal(v: string | undefined): number | null {
  const t = (v ?? '').trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function telefone(ddd: string | undefined, numero: string | undefined): string | null {
  const d = (ddd ?? '').replace(/\D/g, '')
  const n = (numero ?? '').replace(/\D/g, '')
  if (!n) return null
  return d ? `(${d}) ${n}` : n
}

function email(v: string | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

/**
 * Devolve o estabelecimento quando é matriz ativa e o CNAE principal está em
 * `cnaesPrincipais`, ou algum secundário está em `cnaesSecundarios`; senão `null`.
 * Secundário é opt-in: casar por ele traz empresas de outro ramo que só listam
 * a atividade como acessória.
 */
export function parseEstabelecimento(
  campos: string[],
  cnaesPrincipais: ReadonlySet<string>,
  cnaesSecundarios: ReadonlySet<string> = new Set()
): Estabelecimento | null {
  if (campos.length < E_MIN_CAMPOS) return null
  if (campos[E.matrizFilial] !== MATRIZ || campos[E.situacao] !== SITUACAO_ATIVA) return null

  const cnaePrincipal = campos[E.cnaePrincipal]?.trim() ?? ''
  const secundarios = (campos[E.cnaesSecundarios] ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^\d{7}$/.test(c))
  if (!cnaesPrincipais.has(cnaePrincipal) && !secundarios.some((c) => cnaesSecundarios.has(c))) return null
  if (!/^\d{7}$/.test(cnaePrincipal)) return null

  const cnpj = `${campos[E.basico]}${campos[E.ordem]}${campos[E.dv]}`
  if (!/^\d{14}$/.test(cnpj)) return null

  const tipoLogradouro = texto(campos[E.tipoLogradouro])
  const logradouro = texto(campos[E.logradouro])

  return {
    cnpj,
    cnpj_basico: campos[E.basico],
    nome_fantasia: texto(campos[E.fantasia]),
    cnae_principal: cnaePrincipal,
    cnaes_secundarios: secundarios,
    data_inicio_atividade: parseData(campos[E.inicioAtividade]),
    logradouro: logradouro ? [tipoLogradouro, logradouro].filter(Boolean).join(' ') : null,
    numero: texto(campos[E.numero]),
    complemento: texto(campos[E.complemento]),
    bairro: texto(campos[E.bairro]),
    cep: texto(campos[E.cep]),
    uf: texto(campos[E.uf]),
    municipio_codigo: texto(campos[E.municipio]),
    telefone: telefone(campos[E.ddd1], campos[E.tel1]),
    email: email(campos[E.email]),
  }
}

/** Empresas: basico;razao;natureza;qualificacao;capital;porte;ente */
export function parseEmpresa(campos: string[]): { cnpj_basico: string; empresa: Empresa } | null {
  if (campos.length < 6 || !/^\d{8}$/.test(campos[0] ?? '')) return null
  return {
    cnpj_basico: campos[0],
    empresa: {
      razao_social: texto(campos[1]),
      natureza_juridica: texto(campos[2]),
      capital_social: parseDecimal(campos[4]),
      porte: PORTES[(campos[5] ?? '').trim()] ?? null,
    },
  }
}

/** Simples: basico;opcao_simples;data_op;data_exc;opcao_mei;... → só o MEI interessa. */
export function parseSimples(campos: string[]): { cnpj_basico: string; mei: boolean } | null {
  if (campos.length < 5 || !/^\d{8}$/.test(campos[0] ?? '')) return null
  return { cnpj_basico: campos[0], mei: (campos[4] ?? '').trim().toUpperCase() === 'S' }
}

/** Municipios: codigo;descricao */
export function parseMunicipio(campos: string[]): { codigo: string; nome: string } | null {
  const codigo = (campos[0] ?? '').trim()
  const nome = texto(campos[1])
  return codigo && nome ? { codigo, nome } : null
}

/** Normaliza '5510-8/01', '5510801', '55.10-8-01' → '5510801'. */
export function normalizarCnae(v: string): string | null {
  const d = v.replace(/\D/g, '')
  return /^\d{7}$/.test(d) ? d : null
}
