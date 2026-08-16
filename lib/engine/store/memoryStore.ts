// Store em memória — usado nos testes e na demo. Reproduz o comportamento do
// SupabaseStore (incluindo a trava owner='engine' nas leituras de lote), sem rede.
import { engineConfig, OWNER_ENGINE } from '../config'
import { ESTAGIOS_EM_CADENCIA, dominioDoLead } from '../templates'
import { SEED_TEMPLATES } from '../templates-seed'
import type { Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'
import type { Store, TemplateEmail } from './store'

interface InteracaoMem extends NovaInteracao {
  id: string
  created_at: string
}

export class MemoryStore implements Store {
  leads: Lead[]
  interacoes: InteracaoMem[] = []
  usuarios: UsuarioBasico[]
  private seq = 0

  constructor(leads: Lead[] = [], usuarios: UsuarioBasico[] = []) {
    this.leads = leads
    this.usuarios = usuarios
  }

  async buscarLead(id: string): Promise<Lead | null> {
    return this.leads.find((l) => l.id === id) ?? null
  }

  async buscarLeadPorEmail(email: string): Promise<Lead | null> {
    const e = email.trim().toLowerCase()
    return (
      this.leads.find(
        (l) => l.owner === OWNER_ENGINE && l.contato_email?.toLowerCase() === e,
      ) ?? null
    )
  }

  async buscarLeadPorDominio(dominio: string): Promise<Lead | null> {
    const d = dominio.trim().toLowerCase()
    if (!d) return null
    return (
      this.leads.find((l) => l.owner === OWNER_ENGINE && dominioDoLead(l) === d) ?? null
    )
  }

  async atualizarLead(id: string, patch: Partial<Lead>): Promise<void> {
    const lead = this.leads.find((l) => l.id === id)
    if (lead) Object.assign(lead, patch)
  }

  async registrarInteracao(i: NovaInteracao): Promise<void> {
    this.interacoes.push({ ...i, id: `int-${++this.seq}`, created_at: new Date().toISOString() })
  }

  async contarInteracoes(leadId: string, tipo: TipoInteracaoEngine): Promise<number> {
    return this.interacoes.filter(
      (i) => i.lead_id === leadId && i.tipo === tipo && i.origem_acao === 'ia',
    ).length
  }

  async enviosHoje(): Promise<number> {
    const inicioDia = new Date()
    inicioDia.setHours(0, 0, 0, 0)
    return this.interacoes.filter(
      (i) =>
        (i.tipo === 'abordagem' || i.tipo === 'follow_up') &&
        i.origem_acao === 'ia' &&
        new Date(i.created_at).getTime() >= inicioDia.getTime(),
    ).length
  }

  async leadsParaFollowup(): Promise<Lead[]> {
    const agora = Date.now()
    const intervaloMs = engineConfig.horasEntreFollowups * 3600_000
    const elegiveis: Lead[] = []
    for (const lead of this.leads) {
      if (lead.owner !== OWNER_ENGINE) continue
      if (lead.perdido) continue
      if (lead.bounced) continue
      if (!ESTAGIOS_EM_CADENCIA.includes(lead.estagio as never)) continue
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados >= engineConfig.maxFollowups) continue
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
    const agora = Date.now()
    const intervaloMs = engineConfig.horasEntreFollowups * 3600_000
    const esgotados: Lead[] = []
    for (const lead of this.leads) {
      if (lead.owner !== OWNER_ENGINE) continue
      if (lead.perdido) continue
      if (lead.bounced) continue
      if (!ESTAGIOS_EM_CADENCIA.includes(lead.estagio as never)) continue
      const enviados = await this.contarInteracoes(lead.id, 'follow_up')
      if (enviados < engineConfig.maxFollowups) continue
      let venceu = false
      if (lead.proxima_acao_data) venceu = new Date(lead.proxima_acao_data).getTime() <= agora
      else if (lead.ultimo_contato) venceu = new Date(lead.ultimo_contato).getTime() + intervaloMs <= agora
      if (!venceu) continue
      esgotados.push(lead)
    }
    return esgotados
  }

  async buscarUsuario(id: string): Promise<UsuarioBasico | null> {
    return this.usuarios.find((u) => u.id === id) ?? null
  }

  // MemoryStore não rastreia workflow_execucoes — no-op satisfatório para testes
  // que só verificam leads.bounced e elegibilidade de follow-up.
  async cancelarExecucoesWorkflow(_leadId: string): Promise<void> {}

  // Lê do mesmo seed que popula a tabela `templates` (mantém os testes offline).
  // Retorna TODAS as variantes (o seed tem 1 por chave) com id sintético estável.
  async buscarTemplateEmail(nicho: string | null, tipo: string): Promise<TemplateEmail[]> {
    return SEED_TEMPLATES
      .filter((x) => x.canal === 'email' && x.tipo === tipo && (x.nicho ?? null) === nicho)
      .map((t) => ({ id: `${nicho ?? 'generico'}-${tipo}-email`, assunto: t.assunto, corpo: t.corpo }))
  }
}
