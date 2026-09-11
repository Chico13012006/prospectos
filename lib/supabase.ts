import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Tipos principais
export type Lead = {
  id: string
  empresa: string
  cidade: string
  estado: string
  segmento: string
  faixa_funcionarios: string
  site?: string
  linkedin?: string
  contato_nome: string
  contato_cargo: string
  contato_email: string
  contato_telefone?: string
  canal_preferencial: 'email' | 'whatsapp' | 'linkedin' | 'telefone'
  estagio: 'novos_leads' | 'novo' | 'primeiro_contato' | 'aguardando_resposta' | 'follow_up' | 'follow_up_1' | 'follow_up_2' | 'interessado' | 'respondeu' | 'com_closer' | 'reuniao_agendada' | 'ganho' | 'perdido' | 'sem_resposta'
  score: number
  responsavel_id?: string
  responsavel_nome?: string
  usuarios?: {
    id: string
    nome: string
  } | null
  ultimo_contato?: string
  proxima_acao?: string
  proxima_acao_data?: string
  // Cache do nº de follow-ups enviados pelo motor (fonte: interacoes). Mantido
  // pelo engine; usado p/ agrupar a visão Cadência por 1º/2º/3º/4º follow-up.
  followups_enviados?: number
  origem: string
  hubspot_id?: string
  // Trava de migração n8n→motor (migration 0001): os fluxos do engine só agem
  // em leads owner='engine'. Liberação é passo humano deliberado no LeadPanel.
  owner?: 'n8n' | 'engine'
  perdido: boolean
  perdido_motivo?: string
  data_validade?: string | null
  bounced?: boolean | null
  bounced_em?: string | null
  created_at: string
  updated_at: string
}

export type Interacao = {
  id: string
  lead_id: string
  tipo: 'abordagem' | 'resposta' | 'follow_up' | 'nota' | 'reuniao'
  canal?: string
  descricao: string
  origem_acao: 'ia' | 'humano'
  responsavel_id?: string
  created_at: string
  usuarios?: {
    id: string
    nome: string
  } | null
}

// Mensagem real de WhatsApp gravada pelo webhook em `whatsapp_mensagens`
// (fonte única — NÃO é copiada para `interacoes`). A aba Conversa lê esta
// tabela direto e mescla no histórico. Só as colunas que a UI consome.
export type MensagemWhatsapp = {
  id: string
  lead_id: string | null
  organizacao_id: string | null
  // 'inbound' nesta fase; 'outbound' quando houver envio pela plataforma.
  direcao: string
  remetente: string
  remetente_nome: string | null
  // Tipo da Meta: text | image | audio | video | document | sticker | ...
  tipo: string
  // Texto da mensagem quando existe; null para tipos sem texto (sticker etc.).
  conteudo: string | null
  // Timestamp informado pela Meta (cronologia principal da conversa).
  mensagem_em: string
  // Quando a linha foi gravada (fallback de ordenação).
  created_at: string
}

export type Usuario = {
  id: string
  nome: string
  email: string
  cargo: string
  avatar_iniciais: string
  avatar_cor: string
  avatar_bg: string
  ativo: boolean
}

export type Template = {
  id: string
  nome: string
  tipo: string
  canal: string
  nicho?: string
  assunto?: string
  corpo: string
  taxa_resposta: number
  ativo: boolean
}
