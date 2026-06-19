import { supabase, Lead, Interacao, Usuario, Template } from './supabase'

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

// --- INTERACOES ---

export async function getInteracoesByLead(leadId: string): Promise<Interacao[]> {
  const { data, error } = await supabase
    .from('interacoes')
    .select('*')
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
