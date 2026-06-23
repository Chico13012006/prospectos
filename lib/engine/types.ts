// Tipos do motor. Reaproveitam o shape real do Supabase (lib/supabase.ts) e
// adicionam os campos da migration 0001 (owner, tese_comercial, dominio).
import type { Lead as LeadBase, Interacao as InteracaoBase } from '@/lib/supabase'

export type Owner = 'n8n' | 'engine'

// Estágios do funil (vocabulário DESTE projeto — mesmos da UI do pipeline).
export type Estagio =
  | 'novos_leads'
  | 'primeiro_contato'
  | 'aguardando_resposta'
  | 'follow_up'
  | 'interessado'
  | 'reuniao_agendada'
  | 'perdido'

export type Lead = Omit<LeadBase, 'proxima_acao' | 'proxima_acao_data'> & {
  owner?: Owner
  tese_comercial?: string | null
  dominio?: string | null
  // O motor limpa estes campos (null) ao pausar a cadência — alarga p/ aceitar null.
  proxima_acao?: string | null
  proxima_acao_data?: string | null
}

export type Interacao = InteracaoBase

// Tipos de interação usados pelo motor (subconjunto do enum da tabela interacoes).
export type TipoInteracaoEngine = 'abordagem' | 'resposta' | 'follow_up' | 'nota'

export interface NovaInteracao {
  lead_id: string
  tipo: TipoInteracaoEngine
  canal: 'email' | 'sistema' | 'plataforma'
  descricao: string
  origem_acao: 'ia' | 'humano'
  responsavel_id?: string | null
}

// Uma mensagem lida da caixa de entrada (Fluxo 2 — Detectar resposta).
export interface MensagemRecebida {
  de: string // e-mail do remetente
  assunto: string
  corpo: string
  automatica?: boolean // dica do provedor: é auto-resposta?
  em: Date
}

// Usuário (closer/responsável) — subconjunto necessário ao motor.
export interface UsuarioBasico {
  id: string
  nome: string
  email: string
}
