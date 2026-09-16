// Biblioteca de templates da organização: tipos e validação PUROS (client-safe).
// A tabela já é multi-tenant (0006/0007); aqui mora a regra de CONTEÚDO que a
// API impõe e que a tela reaproveita para avisar antes de salvar. Sem I/O.
import { extrairTextoHtmlEmail, sanitizarHtmlEmail } from '@/lib/campanhas/emailCampanha'
import { LIMITE_HTML_CAMPANHA } from '@/lib/campanhas/configuracaoGuiada'
import { ehTemplateDeCampanha } from '@/lib/campanhas/workflowsInternos'
import { normalizarNicho } from '@/lib/nichos/normalizar'

export const CANAIS_TEMPLATE = ['email', 'whatsapp', 'linkedin', 'telefone'] as const
export type CanalTemplate = (typeof CANAIS_TEMPLATE)[number]
export type FormatoTemplate = 'html' | 'texto'

// Mesmo teto do HTML de campanha e do CHECK templates_html_limite (0046), em bytes.
export const LIMITE_HTML_TEMPLATE_BYTES = LIMITE_HTML_CAMPANHA
export const LIMITE_NOME_TEMPLATE = 120
export const LIMITE_ASSUNTO_TEMPLATE = 300
export const LIMITE_CORPO_TEMPLATE = 100_000

// `tipo` é a chave estável pela qual workflows ({ template: tipo }) e o motor
// encontram o template. Mesmo formato dos tipos já gravados.
const TIPO_VALIDO = /^[a-z0-9][a-z0-9_]{0,79}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const MENSAGEM_CHAVE_IMUTAVEL =
  'Canal, estágio e segmento não podem mudar depois de criado o template: workflows e campanhas o encontram por eles.'

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor)
}

export function ehCanalTemplate(valor: unknown): valor is CanalTemplate {
  return typeof valor === 'string' && (CANAIS_TEMPLATE as readonly string[]).includes(valor)
}

// Linha como o repositório seleciona do banco.
export interface LinhaTemplate {
  id: string
  nome: string
  canal: string
  tipo: string
  nicho: string | null
  assunto: string | null
  corpo: string
  html: string | null
  ativo: boolean | null
  created_at: string | null
  atualizado_em: string | null
}

// Forma exposta pela API: sem organizacao_id nem autoria.
export interface TemplateBiblioteca {
  id: string
  nome: string
  canal: CanalTemplate
  formato: FormatoTemplate
  tipo: string
  nicho: string | null
  assunto: string | null
  corpo: string
  html: string | null
  ativo: boolean
  // Cópia materializada por uma campanha (`campanha_*`): só a campanha a altera.
  somenteLeitura: boolean
  criadoEm: string | null
  atualizadoEm: string | null
}

export interface DadosTemplate {
  nome: string
  canal: CanalTemplate
  tipo: string
  nicho: string | null
  assunto: string | null
  corpo: string
  html: string | null
}

export type EdicaoTemplate = Pick<DadosTemplate, 'nome' | 'assunto' | 'corpo' | 'html'>

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string }

// O que impede desativar um template (preenchido por lib/templates/uso.ts e
// devolvido no 409). Fica aqui porque a tela também lê para explicar ao usuário.
export type UsoTemplate =
  | { tipo: 'workflow'; id: string; nome: string; status: string; versao: number }
  | { tipo: 'campanha'; id: string; nome: string; status: string }
  | { tipo: 'execucoes'; quantidade: number }
  | { tipo: 'motor_cadencia'; quantidade: number }

export type FiltroAtivo = 'ativos' | 'inativos' | 'todos'

export interface FiltrosTemplates {
  canal?: CanalTemplate
  formato?: FormatoTemplate
  busca?: string
  // Padrão: 'ativos'.
  ativo?: FiltroAtivo
}

export function formatoDoTemplate(template: { html?: string | null }): FormatoTemplate {
  return template.html ? 'html' : 'texto'
}

export function mapearTemplate(linha: LinhaTemplate): TemplateBiblioteca {
  return {
    id: linha.id,
    nome: linha.nome,
    canal: linha.canal as CanalTemplate,
    formato: formatoDoTemplate(linha),
    tipo: linha.tipo,
    nicho: linha.nicho,
    assunto: linha.assunto,
    corpo: linha.corpo,
    html: linha.html,
    // O motor só usa `ativo = true`; nulo conta como inativo, igual a ele.
    ativo: linha.ativo === true,
    somenteLeitura: ehTemplateDeCampanha(linha.tipo),
    criadoEm: linha.created_at,
    atualizadoEm: linha.atualizado_em,
  }
}

const falha = (erro: string): { ok: false; erro: string } => ({ ok: false, erro })

const objeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '')

const bytes = (valor: string): number => new TextEncoder().encode(valor).byteLength

function validarNome(bruto: unknown): Validacao<string> {
  const nome = texto(bruto)
  if (!nome) return falha('Informe o nome do template.')
  if (nome.length > LIMITE_NOME_TEMPLATE) return falha(`O nome pode ter até ${LIMITE_NOME_TEMPLATE} caracteres.`)
  return { ok: true, valor: nome }
}

function validarTipo(bruto: unknown): Validacao<string> {
  const tipo = texto(bruto).toLowerCase()
  if (!tipo) return falha('Informe o estágio (tipo) do template.')
  if (ehTemplateDeCampanha(tipo)) return falha('O prefixo "campanha_" é reservado às cópias geradas por campanhas.')
  if (!TIPO_VALIDO.test(tipo)) return falha('Estágio inválido: use letras minúsculas, números e _ (até 80).')
  return { ok: true, valor: tipo }
}

interface EntradaConteudo {
  assunto: string
  corpo: string
  html: string
  // HTML já gravado não passa de novo pela sanitização: ela reescapa valores
  // de atributo (`&amp;` → `&amp;amp;`) e corromperia links a cada edição.
  htmlJaSanitizado: boolean
}

// Conteúdo coerente com o canal. HTML só em e-mail, sanitizado com a mesma
// allowlist do preview e do envio; sem corpo explícito, o texto equivalente é
// extraído do HTML. WhatsApp, LinkedIn e telefone não têm assunto.
function validarConteudo(
  canal: CanalTemplate,
  entrada: EntradaConteudo,
): Validacao<Pick<DadosTemplate, 'assunto' | 'corpo' | 'html'>> {
  let html: string | null = null
  let corpo = entrada.corpo
  if (entrada.html) {
    if (canal !== 'email') return falha('HTML só é permitido em templates de e-mail.')
    const limite = `O HTML excede ${LIMITE_HTML_TEMPLATE_BYTES / 1000} KB.`
    if (bytes(entrada.html) > LIMITE_HTML_TEMPLATE_BYTES) return falha(limite)
    html = entrada.htmlJaSanitizado ? entrada.html : sanitizarHtmlEmail(entrada.html).trim()
    if (bytes(html) > LIMITE_HTML_TEMPLATE_BYTES) return falha(limite)
    const textoDoHtml = html ? extrairTextoHtmlEmail(html) : ''
    if (!textoDoHtml) return falha('O HTML não tem conteúdo visível depois da sanitização.')
    if (!corpo) corpo = textoDoHtml
  }
  if (!corpo) return falha('Escreva o texto do template.')
  if (corpo.length > LIMITE_CORPO_TEMPLATE) return falha(`O texto pode ter até ${LIMITE_CORPO_TEMPLATE} caracteres.`)

  if (canal !== 'email') return { ok: true, valor: { assunto: null, corpo, html: null } }
  if (!entrada.assunto) return falha('Informe o assunto do e-mail.')
  if (entrada.assunto.length > LIMITE_ASSUNTO_TEMPLATE) {
    return falha(`O assunto pode ter até ${LIMITE_ASSUNTO_TEMPLATE} caracteres.`)
  }
  return { ok: true, valor: { assunto: entrada.assunto, corpo, html } }
}

// Allow-list: só os campos de conteúdo entram. organizacao_id, id, ativo ou
// autoria vindos do cliente são ignorados — a organização vem da sessão.
export function validarNovoTemplate(bruto: unknown): Validacao<DadosTemplate> {
  const obj = objeto(bruto)
  const nome = validarNome(obj.nome)
  if (!nome.ok) return nome
  const canal = texto(obj.canal)
  if (!ehCanalTemplate(canal)) return falha('Canal inválido.')
  const tipo = validarTipo(obj.tipo)
  if (!tipo.ok) return tipo
  const conteudo = validarConteudo(canal, {
    assunto: texto(obj.assunto),
    corpo: texto(obj.corpo),
    html: texto(obj.html),
    htmlJaSanitizado: false,
  })
  if (!conteudo.ok) return conteudo
  return {
    ok: true,
    valor: { nome: nome.valor, canal, tipo: tipo.valor, nicho: normalizarNicho(texto(obj.nicho) || null), ...conteudo.valor },
  }
}

export function validarEdicaoTemplate(
  atual: Pick<TemplateBiblioteca, 'nome' | 'canal' | 'tipo' | 'nicho' | 'assunto' | 'corpo' | 'html'>,
  bruto: unknown,
): Validacao<EdicaoTemplate> {
  const obj = objeto(bruto)
  if ('canal' in obj && texto(obj.canal) !== atual.canal) return falha(MENSAGEM_CHAVE_IMUTAVEL)
  if ('tipo' in obj && texto(obj.tipo).toLowerCase() !== atual.tipo) return falha(MENSAGEM_CHAVE_IMUTAVEL)
  if ('nicho' in obj && normalizarNicho(texto(obj.nicho) || null) !== atual.nicho) return falha(MENSAGEM_CHAVE_IMUTAVEL)

  const nome = 'nome' in obj ? validarNome(obj.nome) : { ok: true as const, valor: atual.nome }
  if (!nome.ok) return nome

  const htmlInformado = 'html' in obj
  const html = htmlInformado ? texto(obj.html) : atual.html ?? ''
  // HTML novo sem corpo explícito: o texto equivalente é refeito a partir dele,
  // senão o fallback continuaria descrevendo o HTML anterior.
  const corpo = 'corpo' in obj ? texto(obj.corpo) : htmlInformado && html ? '' : atual.corpo
  const conteudo = validarConteudo(atual.canal, {
    assunto: 'assunto' in obj ? texto(obj.assunto) : atual.assunto ?? '',
    corpo,
    html,
    htmlJaSanitizado: !htmlInformado,
  })
  if (!conteudo.ok) return conteudo
  return { ok: true, valor: { nome: nome.valor, ...conteudo.valor } }
}

const FILTRO_ATIVO = new Map<string, FiltroAtivo>([['true', 'ativos'], ['false', 'inativos'], ['todos', 'todos']])

// Query string da listagem. Valor desconhecido é erro explícito, não filtro
// ignorado em silêncio. organizacao_id nunca é lido daqui.
export function lerFiltrosTemplates(params: URLSearchParams): Validacao<FiltrosTemplates> {
  const filtros: FiltrosTemplates = {}
  const canal = params.get('canal')?.trim()
  if (canal) {
    if (!ehCanalTemplate(canal)) return falha('Filtro de canal inválido.')
    filtros.canal = canal
  }
  const formato = params.get('formato')?.trim()
  if (formato) {
    if (formato !== 'html' && formato !== 'texto') return falha('Filtro de formato inválido: use html ou texto.')
    filtros.formato = formato
  }
  const ativo = params.get('ativo')?.trim()
  if (ativo) {
    const valor = FILTRO_ATIVO.get(ativo)
    if (!valor) return falha('Filtro de ativo inválido: use true, false ou todos.')
    filtros.ativo = valor
  }
  const busca = (params.get('busca') ?? params.get('nome'))?.trim()
  if (busca) filtros.busca = busca
  return { ok: true, valor: filtros }
}
