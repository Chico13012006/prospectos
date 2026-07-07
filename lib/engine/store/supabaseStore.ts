// Implementação real do Store sobre o Supabase, usando o client de service role
// (lib/supabase-admin.ts). Mapeia para as tabelas reais `leads`, `interacoes`,
// `usuarios`. A trava owner='engine' é aplicada em TODA leitura de lote.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getEngineConfig, OWNER_ENGINE } from '../config'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import type { Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'
import type { Store, TemplateEmail } from './store'

export class SupabaseStore implements Store {
  private db: SupabaseClient

  constructor(client?: SupabaseClient) {
    this.db = client ?? createSupabaseAdminClient()
  }

  async buscarLead(id: string): Promise<Lead | null> {
    const { data, error } = await this.db.from('leads').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return (data as Lead) ?? null
  }

  async buscarLeadPorEmail(email: string): Promise<Lead | null> {
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('owner', OWNER_ENGINE)
      .ilike('contato_email', email.trim())
      .limit(1)
    if (error) throw error
    return (data?.[0] as Lead) ?? null
  }

  async buscarLeadPorDominio(dominio: string): Promise<Lead | null> {
    const d = dominio.trim().toLowerCase()
    if (!d) return null
    // 1) coluna dominio explícita
    const porColuna = await this.db
      .from('leads')
      .select('*')
      .eq('owner', OWNER_ENGINE)
      .ilike('dominio', d)
      .limit(1)
    if (porColuna.error) throw porColuna.error
    if (porColuna.data?.[0]) return porColuna.data[0] as Lead
    // 2) fallback: domínio derivado do contato_email
    const porEmail = await this.db
      .from('leads')
      .select('*')
      .eq('owner', OWNER_ENGINE)
      .ilike('contato_email', `%@${d}`)
      .limit(1)
    if (porEmail.error) throw porEmail.error
    const lead = (porEmail.data?.[0] as Lead) ?? null
    // Garante que o domínio derivado é realmente de empresa (não gmail etc).
    if (lead && dominioDoLead(lead) === d) return lead
    return null
  }

  async atualizarLead(id: string, patch: Partial<Lead>): Promise<void> {
    const { error } = await this.db.from('leads').update(patch).eq('id', id)
    if (error) throw error
  }

  async registrarInteracao(i: NovaInteracao): Promise<void> {
    const { error } = await this.db.from('interacoes').insert({
      lead_id: i.lead_id,
      tipo: i.tipo,
      canal: i.canal,
      descricao: i.descricao,
      origem_acao: i.origem_acao,
      responsavel_id: i.responsavel_id ?? null,
    })
    if (error) throw error
  }

  async contarInteracoes(leadId: string, tipo: TipoInteracaoEngine): Promise<number> {
    const { count, error } = await this.db
      .from('interacoes')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', leadId)
      .eq('tipo', tipo)
      .eq('origem_acao', 'ia')
    if (error) throw error
    return count ?? 0
  }

  async enviosHoje(): Promise<number> {
    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    const { count, error } = await this.db
      .from('interacoes')
      .select('id', { count: 'exact', head: true })
      .in('tipo', ['abordagem', 'follow_up'])
      .eq('origem_acao', 'ia')
      .gte('created_at', inicioDia.toISOString())
    if (error) throw error
    return count ?? 0
  }

  async leadsParaFollowup(): Promise<Lead[]> {
    const cfg = await getEngineConfig()
    const agora = Date.now()
    const intervaloMs = cfg.horasEntreFollowups * 3600_000
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('owner', OWNER_ENGINE)
      .eq('perdido', false)
      .in('estagio', ESTAGIOS_EM_CADENCIA)
    if (error) throw error

    const candidatos = (data as Lead[]) ?? []
    const elegiveis: Lead[] = []
    for (const lead of candidatos) {
      // Trava de máximo de follow-ups.
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados >= cfg.maxFollowups) continue
      // Gate de tempo: proxima_acao_data se houver, senão ultimo_contato+intervalo.
      if (lead.proxima_acao_data) {
        if (new Date(lead.proxima_acao_data).getTime() > agora) continue
      } else if (lead.ultimo_contato) {
        if (new Date(lead.ultimo_contato).getTime() + intervaloMs > agora) continue
      }
      elegiveis.push(lead)
    }
    return elegiveis
  }

  async leadsEsgotadosSemResposta(): Promise<Lead[]> {
    const cfg = await getEngineConfig()
    const agora = Date.now()
    const intervaloMs = cfg.horasEntreFollowups * 3600_000
    const { data, error } = await this.db
      .from('leads')
      .select('*')
      .eq('owner', OWNER_ENGINE)
      .eq('perdido', false)
      .in('estagio', ESTAGIOS_EM_CADENCIA)
    if (error) throw error

    const candidatos = (data as Lead[]) ?? []
    const esgotados: Lead[] = []
    for (const lead of candidatos) {
      // Só os que ESGOTARAM os follow-ups.
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados < cfg.maxFollowups) continue
      // E cujo tempo de espera do último follow-up já passou.
      let venceu = false
      if (lead.proxima_acao_data) venceu = new Date(lead.proxima_acao_data).getTime() <= agora
      else if (lead.ultimo_contato) venceu = new Date(lead.ultimo_contato).getTime() + intervaloMs <= agora
      if (!venceu) continue
      esgotados.push(lead)
    }
    return esgotados
  }

  async buscarUsuario(id: string): Promise<UsuarioBasico | null> {
    const { data, error } = await this.db
      .from('usuarios')
      .select('id, nome, email')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return (data as UsuarioBasico) ?? null
  }

  async buscarTemplateEmail(nicho: string | null, tipo: string): Promise<TemplateEmail | null> {
    let q = this.db
      .from('templates')
      .select('assunto, corpo')
      .eq('canal', 'email')
      .eq('tipo', tipo)
      .eq('ativo', true)
      .limit(1)
    q = nicho === null ? q.is('nicho', null) : q.eq('nicho', nicho)
    const { data, error } = await q
    if (error) throw error
    return (data?.[0] as TemplateEmail) ?? null
  }
}
