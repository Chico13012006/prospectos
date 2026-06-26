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
  estagio: 'novos_leads' | 'primeiro_contato' | 'aguardando_resposta' | 'follow_up' | 'interessado' | 'reuniao_agendada' | 'perdido'
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
  origem: string
  hubspot_id?: string
  perdido: boolean
  perdido_motivo?: string
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
