// Interface do "banco de dados" do motor. O resto do sistema só conhece esta
// interface, nunca o Supabase diretamente — por isso dá para testar contra um
// MemoryStore sem tocar na rede.
import type { ContextoCampanhaResposta, Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'

// Template de e-mail selecionável pelo motor (subconjunto da tabela `templates`).
// `id` identifica a VARIANTE (A/B testing, item 6) — gravado na interação do envio.
export interface TemplateEmail {
  id: string
  assunto: string | null
  corpo: string
}

export interface Store {
  // Organização à qual este Store está preso (multi-tenant, migration 0006).
  // O SupabaseStore filtra/grava sempre esta org; o MemoryStore (testes) não
  // usa org e deixa undefined. Os fluxos leem daqui p/ pedir a config da org
  // certa (getEngineConfig(store.organizacaoId)).
  readonly organizacaoId?: string
  buscarLead(id: string): Promise<Lead | null>
  // Casa pelo e-mail EXATO do contato (case-insensitive).
  buscarLeadPorEmail(email: string): Promise<Lead | null>
  // Casa pelo domínio da empresa (resposta encaminhada). Usa coluna `dominio`
  // e, como fallback, o domínio do contato_email.
  buscarLeadPorDominio(dominio: string): Promise<Lead | null>
  atualizarLead(id: string, patch: Partial<Lead>): Promise<void>
  registrarInteracao(i: NovaInteracao): Promise<void>
  // Quantas interações de um tipo o lead já tem (base da idempotência).
  contarInteracoes(leadId: string, tipo: TipoInteracaoEngine): Promise<number>
  // Quantos e-mails o motor enviou hoje (respeita o limite diário).
  enviosHoje(): Promise<number>
  // Leads owner='engine' elegíveis para follow-up agora.
  leadsParaFollowup(): Promise<Lead[]>
  // Leads owner='engine' que ESGOTARAM os follow-ups (>= MAX) sem responder e
  // cujo tempo de espera já passou — candidatos a sair para 'sem_resposta'.
  leadsEsgotadosSemResposta(): Promise<Lead[]>
  // Dados do responsável/closer do lead (para notificação do Fluxo 3).
  buscarUsuario(id: string): Promise<UsuarioBasico | null>
  // Responsável configurado na campanha ativa mais recente do lead, quando há.
  buscarResponsavelCampanhaAtiva?(leadId: string): Promise<UsuarioBasico | null>
  // Contexto e modelo de notificação persistidos na campanha ativa.
  buscarContextoCampanhaAtiva?(leadId: string): Promise<ContextoCampanhaResposta | null>
  // TODAS as variantes de e-mail ATIVAS por (nicho, tipo). nicho=null busca o
  // GENÉRICO. A seleção da variante (A/B) e o fallback ficam em mensagem.ts.
  buscarTemplateEmail(nicho: string | null, tipo: string): Promise<TemplateEmail[]>
  // Cancela todas as workflow_execucoes ativas (em_andamento/aguardando) do lead
  // quando há bounce OU resposta real, impedindo novos passos persistentes.
  cancelarExecucoesWorkflow(leadId: string): Promise<void>
}
