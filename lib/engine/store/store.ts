// Interface do "banco de dados" do motor. O resto do sistema só conhece esta
// interface, nunca o Supabase diretamente — por isso dá para testar contra um
// MemoryStore sem tocar na rede.
import type { Lead, NovaInteracao, TipoInteracaoEngine, UsuarioBasico } from '../types'

export interface Store {
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
}
