import { supabase, Lead, Interacao, Usuario, Template } from './supabase'
import { ESTAGIOS_RESERVATORIO } from './pipeline-stages'

// --- LEADS ---

export async function getLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      usuarios:responsavel_id (
        id,
        nome
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Erro ao buscar leads:', error)
    return []
  }
  return data || []
}

// Filtro "Responsável": o dropdown lista `usuarios.nome` (ex.: "Francisco"),
// mas os leads guardam a atribuição de DUAS formas: `responsavel_id` (FK para
// usuarios — fluxo normal da plataforma) e `responsavel_nome` (texto legado do
// import HubSpot via scripts/popular-responsavel.cjs, com o nome COMPLETO do
// CSV, ex.: "Francisco Rufino"). Por isso o filtro casa por id OU por PREFIXO
// do nome — `eq` nunca acharia "Francisco Rufino" a partir de "Francisco".
// O id é resolvido com uma query leve em `usuarios`, cacheada no módulo
// (tabela pequena e estável), para não custar uma query extra por coluna do
// Kanban. Trade-off documentado: o prefixo pode sobrepor nomes ("Ana" casaria
// "Ana Paula"), aceitável com a equipe atual e preferível a esconder leads.
const responsavelIdCache = new Map<string, string | null>()
async function resolverResponsavelId(nome: string): Promise<string | null> {
  const cached = responsavelIdCache.get(nome)
  if (cached !== undefined) return cached
  const { data, error } = await supabase.from('usuarios').select('id').eq('nome', nome).limit(1)
  const id = !error && data && data.length > 0 ? (data[0].id as string) : null
  responsavelIdCache.set(nome, id)
  return id
}

async function filtroResponsavelOr(nome: string): Promise<string> {
  const limpo = nome.replace(/[%,()"]/g, ' ').trim()
  const porNome = `responsavel_nome.ilike.${limpo}%`
  const id = await resolverResponsavelId(nome)
  return id ? `responsavel_id.eq.${id},${porNome}` : porNome
}

export interface PipelineColFiltros {
  responsavel?: string
  segmento?: string
  canal?: string
  busca?: string
  desde?: string | null
  // Visão Cadência: nº de follow-ups enviados — exato (1,2,3) ou cap ({ gte: 4 }).
  followups?: number | { gte: number }
}

// CORAÇÃO DA ESCALA: cada coluna do board usa esta query — NUNCA busca tudo.
// Página com limite/offset (range), filtros server-side e `count: 'exact'`, que
// devolve o TOTAL REAL do(s) estágio(s) mesmo lendo só uma página (p/ o contador
// "Em Prospecção — 1.240"). `ordenarPor`: 'created_at' p/ o reservatório (mais
// novos primeiro), 'ultimo_contato' p/ as colunas de tempo real.
export async function getLeadsPorEstagioPaginado(
  estagios: string[],
  filtros: PipelineColFiltros = {},
  opts: { limit?: number; offset?: number; ordenarPor?: 'created_at' | 'ultimo_contato' } = {},
): Promise<{ data: Lead[]; total: number }> {
  const { limit = 50, offset = 0, ordenarPor = 'ultimo_contato' } = opts
  const { responsavel, segmento, canal, busca, desde, followups } = filtros
  let q = supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })
    .in('estagio', estagios)
  if (typeof followups === 'number') q = q.eq('followups_enviados', followups)
  else if (followups) q = q.gte('followups_enviados', followups.gte)
  if (desde) q = q.gte('created_at', desde)
  if (responsavel) q = q.or(await filtroResponsavelOr(responsavel))
  if (segmento) q = q.eq('segmento', segmento)
  if (canal) q = q.eq('canal_preferencial', canal)
  if (busca && busca.trim()) {
    const t = busca.trim().replace(/[%,()]/g, ' ')
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  if (ordenarPor === 'created_at') {
    q = q.order('created_at', { ascending: false })
  } else {
    q = q.order('ultimo_contato', { ascending: false, nullsFirst: false })
  }
  // Desempate por id: sem ele, linhas empatadas (mesma data / null) podem mudar
  // de ordem entre queries e o scroll infinito duplica/pula leads entre páginas.
  q = q.order('id', { ascending: true })
  const { data, error, count } = await q.range(offset, offset + limit - 1)
  if (error) {
    console.error('getLeadsPorEstagioPaginado:', error)
    return { data: [], total: 0 }
  }
  return { data: (data ?? []) as Lead[], total: count ?? 0 }
}

// RESERVATÓRIO "Novos Leads": caso particular do paginado, com filtro de data
// (default últimos 30 dias) e ordenação por data de entrada.
export async function getNovosLeads(opts: {
  desde?: string | null
  busca?: string
  responsavel?: string
  segmento?: string
  canal?: string
  limit?: number
  offset?: number
}): Promise<{ data: Lead[]; total: number }> {
  const { desde, busca, responsavel, segmento, canal, limit = 50, offset = 0 } = opts
  return getLeadsPorEstagioPaginado(
    ESTAGIOS_RESERVATORIO,
    { desde, busca, responsavel, segmento, canal },
    { limit, offset, ordenarPor: 'created_at' },
  )
}

// Opções dos filtros globais (responsável / nicho / canal). Não derivamos mais
// dos leads carregados (não carregamos todos). Responsáveis vêm de `usuarios`
// (tabela pequena); canais são um enum fixo; segmentos saem de um distinct leve.
const CANAIS_FIXOS = ['email', 'whatsapp', 'linkedin', 'telefone']
export async function getPipelineFiltrosOpcoes(): Promise<{
  responsaveis: string[]
  segmentos: string[]
  canais: string[]
}> {
  const [usuariosRes, segRes] = await Promise.all([
    supabase.from('usuarios').select('nome').eq('ativo', true),
    supabase.from('leads').select('segmento').not('segmento', 'is', null),
  ])
  if (usuariosRes.error) throw usuariosRes.error
  if (segRes.error) throw segRes.error
  const responsaveis = [...new Set((usuariosRes.data ?? []).map(u => u.nome).filter(Boolean))].sort() as string[]
  const segmentos = [...new Set((segRes.data ?? []).map(s => s.segmento).filter(Boolean))].sort() as string[]
  return { responsaveis, segmentos, canais: CANAIS_FIXOS }
}

// BASE DE LEADS: banco geral de TODOS os leads (qualquer estado). Paginado no
// servidor (range), COUNT exato, busca e filtros server-side. NUNCA busca tudo.
// Campos aceitos para ordenação da Tabela operacional (evita passar coluna
// arbitrária direto pro Supabase a partir do clique do usuário).
export type LeadOrdenavel =
  | 'empresa' | 'segmento' | 'canal_preferencial' | 'estagio'
  | 'ultimo_contato' | 'created_at' | 'responsavel_nome' | 'contato_cargo'

export interface BaseLeadsFiltros {
  busca?: string
  responsavel?: string
  segmento?: string
  canal?: string             // canal_preferencial exato
  estagio?: string           // status comercial exato
  estagios?: string[]        // grupo de estágios (chips rápidos — ex.: colunas do Kanban)
  followups?: number | { gte: number }
  cidade?: string
  estado?: string
  cadastroDe?: string | null   // created_at >=
  cadastroAte?: string | null  // created_at <=
  interacaoDe?: string | null  // ultimo_contato >=
  interacaoAte?: string | null // ultimo_contato <=
  atalho?: 'responderam' | 'sem_resposta' | 'arquivados' | 'reativacao'
  ordenarPor?: { campo: LeadOrdenavel; asc: boolean }
}

export async function getTodosLeads(
  filtros: BaseLeadsFiltros = {},
  opts: { limit?: number; offset?: number } = {},
): Promise<{ data: Lead[]; total: number }> {
  const { limit = 50, offset = 0 } = opts
  const f = filtros
  let q = supabase.from('leads').select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })

  if (f.busca && f.busca.trim()) {
    const t = f.busca.trim().replace(/[%,()]/g, ' ')
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  if (f.responsavel) q = q.or(await filtroResponsavelOr(f.responsavel))
  if (f.segmento) q = q.eq('segmento', f.segmento)
  if (f.canal) q = q.eq('canal_preferencial', f.canal)
  if (f.estagio) q = q.eq('estagio', f.estagio)
  else if (f.estagios && f.estagios.length) q = q.in('estagio', f.estagios)
  if (typeof f.followups === 'number') q = q.eq('followups_enviados', f.followups)
  else if (f.followups) q = q.gte('followups_enviados', f.followups.gte)
  if (f.cidade && f.cidade.trim()) q = q.ilike('cidade', `%${f.cidade.trim()}%`)
  if (f.estado && f.estado.trim()) q = q.ilike('estado', f.estado.trim())
  if (f.cadastroDe) q = q.gte('created_at', f.cadastroDe)
  if (f.cadastroAte) q = q.lte('created_at', f.cadastroAte)
  if (f.interacaoDe) q = q.gte('ultimo_contato', f.interacaoDe)
  if (f.interacaoAte) q = q.lte('ultimo_contato', f.interacaoAte)

  // Atalhos rápidos (chips) → restrições por estágio.
  if (f.atalho === 'responderam') q = q.in('estagio', ['interessado', 'respondeu', 'com_closer'])
  else if (f.atalho === 'sem_resposta' || f.atalho === 'reativacao') q = q.eq('estagio', 'sem_resposta')
  else if (f.atalho === 'arquivados') q = q.or('perdido.eq.true,estagio.eq.perdido,estagio.eq.descartado')

  const ordenarPor = f.ordenarPor ?? { campo: 'created_at' as const, asc: false }
  q = q.order(ordenarPor.campo, { ascending: ordenarPor.asc, nullsFirst: false })
  // Desempate por id: colunas de baixa cardinalidade (segmento, canal, estágio)
  // empatam milhares de linhas — sem ordem total, a página 2 pode repetir ou
  // pular leads da página 1.
  q = q.order('id', { ascending: true })

  const { data, error, count } = await q.range(offset, offset + limit - 1)
  if (error) {
    console.error('getTodosLeads:', error)
    return { data: [], total: 0 }
  }
  return { data: (data ?? []) as Lead[], total: count ?? 0 }
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createLead(lead: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert(lead)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLeadEstagio(id: string, estagio: Lead['estagio']): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ estagio })
    .eq('id', id)
  if (error) throw error
}

// Atualiza o estágio de um lead e registra o último contato
export async function atualizarEstagio(leadId: string, novoEstagio: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({
      estagio: novoEstagio,
      ultimo_contato: new Date().toISOString(),
    })
    .eq('id', leadId)
  if (error) throw error
}

// Dispara o MOTOR (lib/engine, não mais o n8n) para executar a próxima etapa
// da cadência do lead. Trocado de /api/executar-acao (proxy do n8n, parado)
// para /api/engine/executar-acao em 06/07/2026. O endpoint do motor exige o
// header de autorização interna — por isso o NEXT_PUBLIC_INTERNAL_SECRET.
export async function executarAcao(
  leadId: string
): Promise<{ ok: boolean; estagio?: string; erro?: string; motivo?: string }> {
  const res = await fetch('/api/engine/executar-acao', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.NEXT_PUBLIC_INTERNAL_SECRET ?? '',
    },
    body: JSON.stringify({ lead_id: leadId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? err.motivo ?? `Erro ${res.status}`)
  }

  return res.json()
}

// Registra uma interação/nota no histórico
export async function registrarNota(leadId: string, descricao: string, tipo: string = 'nota'): Promise<void> {
  const { error } = await supabase
    .from('interacoes')
    .insert({
      lead_id: leadId,
      tipo,
      canal: 'plataforma',
      descricao,
      origem_acao: 'humano',
    })
  if (error) throw error
}

// --- INTERACOES ---

export async function getInteracoesByLead(leadId: string): Promise<Interacao[]> {
  const { data, error } = await supabase
    .from('interacoes')
    .select(`
      *,
      usuarios:responsavel_id (
        id,
        nome
      )
    `)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createInteracao(interacao: Partial<Interacao>): Promise<Interacao> {
  const { data, error } = await supabase
    .from('interacoes')
    .insert(interacao)
    .select()
    .single()
  if (error) throw error
  return data
}

// --- USUARIOS ---

export async function getUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('ativo', true)
  if (error) throw error
  return data || []
}

// --- TEMPLATES ---

export async function getTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  return data || []
}

// --- ANALYTICS / DASHBOARD ---

export async function getLeadsStats() {
  const { data, error } = await supabase
    .from('leads')
    .select('estagio, score, responsavel_id, created_at, canal_preferencial, segmento, estado')
  if (error || !data) return null
  return data
}

export async function getLeadsRecentes(limit = 10) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data
}

export async function getLeadsPorResponsavel() {
  const { data: usuarios, error: errU } = await supabase
    .from('usuarios')
    .select('id, nome')
  const { data: leads, error: errL } = await supabase
    .from('leads')
    .select('responsavel_id, responsavel_nome, estagio')
  if (errU || errL || !usuarios || !leads) return []

  // Mesmo padrão do filtroResponsavelOr, aplicado em memória: casa por FK
  // (responsavel_id) OU por prefixo do nome legado do CSV ("Francisco" →
  // "Francisco Rufino"). `responsavel_id` NÃO é fonte de verdade hoje —
  // nenhum fluxo do app grava essa coluna; todos os leads vieram do import
  // HubSpot, que só preenche responsavel_nome.
  const doResponsavel = (
    l: { responsavel_id?: string | null; responsavel_nome?: string | null },
    u: { id: string; nome: string },
  ) =>
    l.responsavel_id === u.id ||
    (!!l.responsavel_nome && l.responsavel_nome.toLowerCase().startsWith(u.nome.toLowerCase()))

  return usuarios.map(u => {
    const meus = leads.filter(l => doResponsavel(l, u))
    return {
      nome: u.nome,
      total: meus.length,
      reunioes: meus.filter(l => l.estagio === 'reuniao_agendada').length,
      interessados: meus.filter(l => l.estagio === 'interessado').length,
    }
  })
}
