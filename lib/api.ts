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

// Colunas de TEMPO REAL (pequenas): carrega todos os leads dos estágios dados,
// com teto de segurança. Inclui o nome do responsável (join usuarios).
export async function getLeadsPorColuna(estagios: string[]): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)')
    .in('estagio', estagios)
    .order('ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(1000)
  if (error) {
    console.error('getLeadsPorColuna:', error)
    return []
  }
  return (data ?? []) as Lead[]
}

// RESERVATÓRIO "Novos Leads": NUNCA busca tudo. Página com limite/offset,
// filtro de data (default últimos 30 dias), busca e filtros globais. Devolve a
// página + o total (count exato) para o contador.
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
  let q = supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })
    .in('estagio', ESTAGIOS_RESERVATORIO)
  if (desde) q = q.gte('created_at', desde)
  if (responsavel) q = q.eq('responsavel_nome', responsavel)
  if (segmento) q = q.eq('segmento', segmento)
  if (canal) q = q.eq('canal_preferencial', canal)
  if (busca && busca.trim()) {
    const t = busca.trim().replace(/[%,()]/g, ' ')
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) {
    console.error('getNovosLeads:', error)
    return { data: [], total: 0 }
  }
  return { data: (data ?? []) as Lead[], total: count ?? 0 }
}

// Terminais fora do board (Perdido / Sem resposta), paginado.
export async function getLeadsOffboard(
  tipo: 'perdido' | 'sem_resposta',
  opts: { limit?: number; offset?: number } = {},
): Promise<{ data: Lead[]; total: number }> {
  const { limit = 50, offset = 0 } = opts
  let q = supabase.from('leads').select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })
  q = tipo === 'perdido' ? q.or('perdido.eq.true,estagio.eq.perdido') : q.eq('estagio', 'sem_resposta')
  const { data, error, count } = await q
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) {
    console.error('getLeadsOffboard:', error)
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
