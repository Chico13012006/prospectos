import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarUsosImpeditivos, type UsoTemplate } from './uso'
import {
  ehCanalTemplate,
  ehUuid,
  mapearTemplate,
  validarEdicaoTemplate,
  validarNovoTemplate,
  type FiltrosTemplates,
  type LinhaTemplate,
  type TemplateBiblioteca,
} from './tipos'

// Acesso à biblioteca de templates, SEMPRE escopado por organização. O client é
// service_role (ignora RLS): toda leitura e escrita filtra e grava
// organizacao_id explicitamente, inclusive por id. A organização vem do
// contexto autenticado da rota, nunca do corpo da requisição. A policy
// templates_tenant e o trigger de organização imutável (0046) são o backstop.

const COLUNAS = 'id, nome, canal, tipo, nicho, assunto, corpo, html, ativo, created_at, atualizado_em'
const LIMITE_LISTA = 1000
const CAMPOS_CONTEUDO = ['nome', 'assunto', 'corpo', 'html', 'canal', 'tipo', 'nicho']

// Mesma resposta para "não existe" e "é de outra organização": nada pode
// revelar que o id existe em outro tenant.
export const MENSAGEM_TEMPLATE_NAO_ENCONTRADO = 'Template não encontrado.'

export class ErroTemplate extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'ErroTemplate'
  }
}

export class ErroTemplateEmUso extends ErroTemplate {
  constructor(readonly usos: UsoTemplate[]) {
    super('Este template está em uso e não pode ser desativado. Troque o template ou encerre os usos listados.', 409)
    this.name = 'ErroTemplateEmUso'
  }
}

const objeto = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {}

function lerAtivo(obj: Record<string, unknown>): boolean | undefined {
  if (!('ativo' in obj)) return undefined
  if (typeof obj.ativo !== 'boolean') throw new ErroTemplate('O campo ativo deve ser verdadeiro ou falso.', 400)
  return obj.ativo
}

// Curingas do ilike (% _ *) e a barra viram espaço: a busca é por trecho literal.
function termoBusca(valor: string | null | undefined): string {
  return (valor ?? '').replace(/[%_*\\]/g, ' ').trim().slice(0, 100)
}

export async function listarTemplates(
  admin: SupabaseClient,
  org: string,
  filtros: FiltrosTemplates = {},
): Promise<TemplateBiblioteca[]> {
  let consulta = admin.from('templates').select(COLUNAS).eq('organizacao_id', org)
  if (ehCanalTemplate(filtros.canal)) consulta = consulta.eq('canal', filtros.canal)
  if (filtros.formato === 'html') consulta = consulta.not('html', 'is', null)
  if (filtros.formato === 'texto') consulta = consulta.is('html', null)
  const ativo = filtros.ativo ?? 'ativos'
  if (ativo === 'ativos') consulta = consulta.eq('ativo', true)
  if (ativo === 'inativos') consulta = consulta.not('ativo', 'is', true)
  const busca = termoBusca(filtros.busca)
  if (busca) consulta = consulta.ilike('nome', `%${busca}%`)

  const { data, error } = await consulta
    .order('nome', { ascending: true })
    .order('id', { ascending: true })
    .limit(LIMITE_LISTA)
  if (error) throw new Error(error.message)
  // Cópias `campanha_*` pertencem à campanha que as gerou e ficam fora da
  // biblioteca (mesma regra de apenasTemplatesAutorais).
  return ((data ?? []) as unknown as LinhaTemplate[]).map(mapearTemplate).filter((t) => !t.somenteLeitura)
}

export async function buscarTemplate(
  admin: SupabaseClient,
  org: string,
  id: string,
): Promise<TemplateBiblioteca | null> {
  if (!ehUuid(id)) return null
  const { data, error } = await admin
    .from('templates')
    .select(COLUNAS)
    .eq('organizacao_id', org)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapearTemplate(data as unknown as LinhaTemplate) : null
}

async function exigirEditavel(admin: SupabaseClient, org: string, id: string): Promise<TemplateBiblioteca> {
  const atual = await buscarTemplate(admin, org, id)
  if (!atual) throw new ErroTemplate(MENSAGEM_TEMPLATE_NAO_ENCONTRADO, 404)
  if (atual.somenteLeitura) {
    throw new ErroTemplate('Este template foi gerado por uma campanha e só pode ser alterado pela própria campanha.', 409)
  }
  return atual
}

async function exigirSemUsoImpeditivo(admin: SupabaseClient, org: string, template: TemplateBiblioteca) {
  const usos = await buscarUsosImpeditivos(admin, org, template)
  if (usos.length) throw new ErroTemplateEmUso(usos)
}

async function gravar(
  admin: SupabaseClient,
  org: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<TemplateBiblioteca> {
  const { data, error } = await admin
    .from('templates')
    .update(patch)
    .eq('organizacao_id', org)
    .eq('id', id)
    .select(COLUNAS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ErroTemplate(MENSAGEM_TEMPLATE_NAO_ENCONTRADO, 404)
  return mapearTemplate(data as unknown as LinhaTemplate)
}

export async function criarTemplate(
  admin: SupabaseClient,
  org: string,
  perfilId: string,
  bruto: unknown,
): Promise<TemplateBiblioteca> {
  const ativo = lerAtivo(objeto(bruto)) ?? true
  const validacao = validarNovoTemplate(bruto)
  if (!validacao.ok) throw new ErroTemplate(validacao.erro, 400)
  const { data, error } = await admin
    .from('templates')
    .insert({
      ...validacao.valor,
      ativo,
      organizacao_id: org,
      criado_por: perfilId,
      atualizado_por: perfilId,
    })
    .select(COLUNAS)
    .single()
  if (error) throw new Error(error.message)
  return mapearTemplate(data as unknown as LinhaTemplate)
}

// Edita conteúdo (nome, assunto, corpo, html) e/ou `ativo`. Canal, estágio,
// segmento e organização não mudam. Desativar passa pela mesma checagem de uso
// do DELETE, antes de qualquer escrita.
export async function atualizarTemplate(
  admin: SupabaseClient,
  org: string,
  perfilId: string,
  id: string,
  bruto: unknown,
): Promise<TemplateBiblioteca> {
  const atual = await exigirEditavel(admin, org, id)
  const obj = objeto(bruto)
  const ativo = lerAtivo(obj)
  const temConteudo = CAMPOS_CONTEUDO.some((campo) => campo in obj)
  if (!temConteudo && ativo === undefined) throw new ErroTemplate('Nenhum campo editável informado.', 400)

  const patch: Record<string, unknown> = {}
  if (temConteudo) {
    const validacao = validarEdicaoTemplate(atual, obj)
    if (!validacao.ok) throw new ErroTemplate(validacao.erro, 400)
    Object.assign(patch, validacao.valor)
  }
  if (ativo !== undefined && ativo !== atual.ativo) {
    if (!ativo) await exigirSemUsoImpeditivo(admin, org, atual)
    patch.ativo = ativo
  }
  if (Object.keys(patch).length === 0) return atual
  return gravar(admin, org, id, { ...patch, atualizado_por: perfilId })
}

// "Excluir" na biblioteca é desativar: o histórico (interacoes.template_id,
// execuções) continua apontando para a linha.
export async function definirAtivoTemplate(
  admin: SupabaseClient,
  org: string,
  perfilId: string,
  id: string,
  ativo: boolean,
): Promise<TemplateBiblioteca> {
  const atual = await exigirEditavel(admin, org, id)
  if (atual.ativo === ativo) return atual
  if (!ativo) await exigirSemUsoImpeditivo(admin, org, atual)
  return gravar(admin, org, id, { ativo, atualizado_por: perfilId })
}
