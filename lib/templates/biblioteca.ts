// Regras de apresentação da biblioteca de templates. Puras e client-safe: a
// tela só desenha o que estas funções decidem — e o backend continua sendo a
// autoridade (a API repete cada checagem).
import { CANAIS_TEMPLATE, type CanalTemplate, type FiltrosTemplates, type FormatoTemplate, type TemplateBiblioteca, type UsoTemplate } from './tipos'

export interface OpcaoRotulo<T extends string> {
  valor: T
  label: string
}

const ROTULO_CANAL: Record<CanalTemplate, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  telefone: 'Telefone',
}

// Filtros e listagem cobrem os quatro canais: LinkedIn e telefone existem como
// referência manual desde o seed e não podem sumir da biblioteca.
export const CANAIS_FILTRO: OpcaoRotulo<CanalTemplate>[] = CANAIS_TEMPLATE.map((valor) => ({ valor, label: ROTULO_CANAL[valor] }))

// Criar template novo é só para os canais que o produto usa hoje.
export const CANAIS_NOVO_TEMPLATE: OpcaoRotulo<CanalTemplate>[] = [
  { valor: 'email', label: 'E-mail' },
  { valor: 'whatsapp', label: 'WhatsApp' },
]

export const FORMATOS_FILTRO: OpcaoRotulo<FormatoTemplate>[] = [
  { valor: 'html', label: 'HTML' },
  { valor: 'texto', label: 'Texto' },
]

export function rotuloCanal(canal: string): string {
  return ROTULO_CANAL[canal as CanalTemplate] ?? canal
}

export function rotuloFormato(formato: FormatoTemplate): string {
  return formato === 'html' ? 'HTML' : 'Texto'
}

export function rotuloStatus(ativo: boolean): string {
  return ativo ? 'Ativo' : 'Inativo'
}

export function formatarAtualizadoEm(iso: string | null): string {
  if (!iso) return '—'
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return '—'
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Query string de GET /api/templates. Campo vazio não vira filtro.
export function queryFiltros(filtros: FiltrosTemplates): string {
  const params = new URLSearchParams()
  if (filtros.canal) params.set('canal', filtros.canal)
  if (filtros.formato) params.set('formato', filtros.formato)
  if (filtros.busca?.trim()) params.set('busca', filtros.busca.trim())
  if (filtros.ativo === 'inativos') params.set('ativo', 'false')
  if (filtros.ativo === 'todos') params.set('ativo', 'todos')
  const query = params.toString()
  return query ? `?${query}` : ''
}

export interface AcessoBiblioteca {
  podeVer: boolean
  podeGerenciar: boolean
}

export function acessoBiblioteca(permissoes: readonly string[]): AcessoBiblioteca {
  return {
    podeVer: permissoes.includes('templates.view'),
    podeGerenciar: permissoes.includes('templates.manage'),
  }
}

export type AcaoTemplate = 'visualizar' | 'editar' | 'desativar' | 'reativar'

// Visualizar é sempre possível para quem abre a biblioteca; o resto exige
// `templates.manage`. Cópia de campanha nem chega aqui (a API não a lista).
export function acoesDoTemplate(template: TemplateBiblioteca, podeGerenciar: boolean): AcaoTemplate[] {
  if (!podeGerenciar) return ['visualizar']
  return ['visualizar', 'editar', template.ativo ? 'desativar' : 'reativar']
}

const plural = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`

function descreverUso(uso: UsoTemplate): string {
  switch (uso.tipo) {
    case 'workflow': return `workflow "${uso.nome}" (${uso.status}, versão ${uso.versao})`
    case 'campanha': return `campanha "${uso.nome}" (${uso.status})`
    case 'execucoes': return plural(uso.quantidade, 'execução em andamento', 'execuções em andamento')
    case 'motor_cadencia': return plural(uso.quantidade, 'lead na cadência automática', 'leads na cadência automática')
  }
}

// Mensagem do 409: diz o que impede e o caminho de saída, sem jargão de API.
export function mensagemUsos(usos: readonly UsoTemplate[]): string {
  if (usos.length === 0) return 'Este template está em uso e não pode ser desativado agora.'
  return `Este template ainda é usado por ${usos.map(descreverUso).join(', ')}. ` +
    'Troque o template nesses lugares (ou crie uma variante ativa com a mesma chave) antes de desativar.'
}

// Erro de API com o corpo já interpretado — a tela precisa do 409 e dos usos.
export class ErroTemplateApi extends Error {
  constructor(message: string, readonly status: number, readonly usos: UsoTemplate[] = []) {
    super(message)
    this.name = 'ErroTemplateApi'
  }
}
