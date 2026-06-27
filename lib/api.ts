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
  if (responsavel) q = q.eq('responsavel_nome', responsavel)
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
export interface BaseLeadsFiltros {
  busca?: string
  responsavel?: string
  segmento?: string
  estagio?: string          // status comercial exato
  followups?: number | { gte: number }
  cidade?: string
  estado?: string
  cadastroDe?: string | null   // created_at >=
  cadastroAte?: string | null  // created_at <=
  interacaoDe?: string | null  // ultimo_contato >=
  interacaoAte?: string | null // ultimo_contato <=
  atalho?: 'responderam' | 'sem_resposta' | 'arquivados' | 'reativacao'
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
  if (f.responsavel) q = q.eq('responsavel_nome', f.responsavel)
  if (f.segmento) q = q.eq('segmento', f.segmento)
  if (f.estagio) q = q.eq('estagio', f.estagio)
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

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
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

// Dispara o n8n (via proxy server-side) para executar a próxima etapa da cadência do lead
export async function executarAcao(
  leadId: string
): Promise<{ ok: boolean; estagio?: string; erro?: string }> {
  const res = await fetch('/api/executar-acao', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lead_id: leadId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? `Erro ${res.status}`)
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
    .select('*')
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
    .select('responsavel_id, estagio')
  if (errU || errL || !usuarios || !leads) return []

  return usuarios.map(u => ({
    nome: u.nome,
    total: leads.filter(l => l.responsavel_id === u.id).length,
    reunioes: leads.filter(l => l.responsavel_id === u.id && l.estagio === 'reuniao_agendada').length,
    interessados: leads.filter(l => l.responsavel_id === u.id && l.estagio === 'interessado').length,
  }))
}
