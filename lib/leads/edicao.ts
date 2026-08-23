import { emailValido } from './importarCsv'

export const CANAIS_PREFERENCIAIS = ['email', 'whatsapp', 'linkedin', 'telefone'] as const
export type CanalPreferencial = (typeof CANAIS_PREFERENCIAIS)[number]

export interface PatchCadastralLead {
  contato_nome?: string
  contato_email?: string
  contato_telefone?: string | null
  contato_cargo?: string | null
  canal_preferencial?: CanalPreferencial
  empresa?: string
  segmento?: string | null
  site?: string | null
  cidade?: string | null
  estado?: string | null
  faixa_funcionarios?: string | null
  origem?: string
  data_validade?: string | null
}

export class ErroEdicaoLead extends Error {}

const LIMITES: Record<keyof Omit<PatchCadastralLead, 'canal_preferencial' | 'data_validade'>, number> = {
  contato_nome: 200,
  contato_email: 320,
  contato_telefone: 32,
  contato_cargo: 160,
  empresa: 240,
  segmento: 160,
  site: 500,
  cidade: 120,
  estado: 80,
  faixa_funcionarios: 80,
  origem: 160,
}

function possui(obj: Record<string, unknown>, campo: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, campo)
}

function texto(obj: Record<string, unknown>, campo: keyof typeof LIMITES, label: string): string {
  const valor = obj[campo]
  if (typeof valor !== 'string') throw new ErroEdicaoLead(`${label} inválido.`)
  const normalizado = valor.trim()
  if (normalizado.length > LIMITES[campo]) {
    throw new ErroEdicaoLead(`${label} deve ter no máximo ${LIMITES[campo]} caracteres.`)
  }
  return normalizado
}

function dataIsoValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const data = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor
}

function siteValido(valor: string): boolean {
  if (/^https?:\/\//i.test(valor)) {
    try {
      const url = new URL(valor)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }
  return !/\s/.test(valor) && /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(valor)
}

// Allowlist de campos cadastrais. Estados do motor/pipeline nunca entram aqui.
export function normalizarPatchCadastralLead(entrada: unknown): PatchCadastralLead {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new ErroEdicaoLead('Dados do lead inválidos.')
  }
  const dados = entrada as Record<string, unknown>
  const patch: PatchCadastralLead = {}

  if (possui(dados, 'contato_nome')) {
    const valor = texto(dados, 'contato_nome', 'Nome do contato')
    if (!valor) throw new ErroEdicaoLead('Informe o nome do contato.')
    patch.contato_nome = valor
  }
  if (possui(dados, 'contato_email')) {
    const valor = texto(dados, 'contato_email', 'E-mail').toLowerCase()
    if (!valor || !emailValido(valor)) throw new ErroEdicaoLead('Informe um e-mail válido.')
    patch.contato_email = valor
  }
  if (possui(dados, 'contato_telefone')) {
    const valor = texto(dados, 'contato_telefone', 'Telefone').replace(/[^\d+]/g, '')
    patch.contato_telefone = valor || null
  }
  if (possui(dados, 'contato_cargo')) patch.contato_cargo = texto(dados, 'contato_cargo', 'Cargo') || null
  if (possui(dados, 'canal_preferencial')) {
    if (typeof dados.canal_preferencial !== 'string' || !CANAIS_PREFERENCIAIS.includes(dados.canal_preferencial as CanalPreferencial)) {
      throw new ErroEdicaoLead('Canal preferencial inválido.')
    }
    patch.canal_preferencial = dados.canal_preferencial as CanalPreferencial
  }

  if (possui(dados, 'empresa')) {
    const valor = texto(dados, 'empresa', 'Empresa')
    if (!valor) throw new ErroEdicaoLead('Informe a empresa.')
    patch.empresa = valor
  }
  if (possui(dados, 'segmento')) patch.segmento = texto(dados, 'segmento', 'Nicho') || null
  if (possui(dados, 'site')) {
    const valor = texto(dados, 'site', 'Site')
    if (valor && !siteValido(valor)) throw new ErroEdicaoLead('Informe um site válido.')
    patch.site = valor || null
  }
  if (possui(dados, 'cidade')) patch.cidade = texto(dados, 'cidade', 'Cidade') || null
  if (possui(dados, 'estado')) {
    const valor = texto(dados, 'estado', 'Estado')
    patch.estado = valor ? (valor.length <= 2 ? valor.toUpperCase() : valor) : null
  }
  if (possui(dados, 'faixa_funcionarios')) patch.faixa_funcionarios = texto(dados, 'faixa_funcionarios', 'Faixa de funcionários') || null
  if (possui(dados, 'origem')) {
    const valor = texto(dados, 'origem', 'Origem')
    if (!valor) throw new ErroEdicaoLead('Informe a origem.')
    patch.origem = valor
  }
  if (possui(dados, 'data_validade')) {
    if (dados.data_validade === null || dados.data_validade === '') patch.data_validade = null
    else if (typeof dados.data_validade === 'string' && dataIsoValida(dados.data_validade)) patch.data_validade = dados.data_validade
    else throw new ErroEdicaoLead('Data de validade inválida.')
  }

  if (Object.keys(patch).length === 0) throw new ErroEdicaoLead('Nada para atualizar.')
  return patch
}
