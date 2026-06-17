export type Segmento = 'Logística' | 'Petróleo' | 'Mineração' | 'Agro' | 'Indústria' | 'Varejo' | 'Outro';
export type Origem = 'LinkedIn' | 'Indicação' | 'Pesquisa própria' | 'Evento' | 'Cold list' | 'Automação';
export type Canal = 'LinkedIn' | 'Email' | 'WhatsApp' | 'Telefone';

export type StatusLead =
  | 'novo'
  | 'em_prospeccao'
  | 'aguardando_resposta'
  | 'respondeu_positivo'
  | 'pediu_mais_info'
  | 'sem_interesse_agora'
  | 'reativar_futuramente'
  | 'descartado'
  | 'blacklist';

export type OrigemAcao = 'humano' | 'automatico';

export type EstagioPipeline =
  | 'novos_leads'
  | 'primeiro_contato'
  | 'aguardando_resposta'
  | 'follow_up'
  | 'interessado'
  | 'reuniao_agendada';

export interface Empresa {
  id: string;
  nome: string;
  segmento: Segmento;
  origem: Origem;
  cidade: string;
  estado: string;
  website?: string;
  responsavel: string;
  status: StatusLead;
  estagio_pipeline: EstagioPipeline;
  em_cadencia: boolean;
  cadencia_id?: string;
  etapa_atual_cadencia?: number;
  data_entrada: string;
  ultimo_contato?: string;
  ultimo_contato_origem?: OrigemAcao;
  blacklist: boolean;
  motivo_blacklist?: string;
  score_engajamento: number;
  observacoes?: string;
  funcionarios_faixa?: string;
  faturamento_estimado?: string;
}

export interface Contato {
  id: string;
  empresa_id: string;
  nome: string;
  cargo: string;
  canal_preferencial: Canal;
  linkedin_url?: string;
  email?: string;
  telefone?: string;
  principal: boolean;
  blacklist: boolean;
}

export interface EtapaCadencia {
  numero: number;
  dia_offset: number;
  canal: Canal;
  template_id: string;
  acao: 'enviar_mensagem' | 'ligar' | 'enviar_material' | 'aguardar';
  executado_por: OrigemAcao;
}

export interface Cadencia {
  id: string;
  nome: string;
  descricao: string;
  ativa: boolean;
  etapas: EtapaCadencia[];
}

export interface Template {
  id: string;
  nome: string;
  canal: Canal;
  assunto?: string;
  corpo: string;
  tags: string[];
  taxa_resposta: number;
  total_usos: number;
}

export interface Abordagem {
  id: string;
  empresa_id: string;
  contato_id: string;
  data: string;
  canal: Canal;
  template_id?: string;
  mensagem_enviada: string;
  responsavel: string;
  origem_acao: OrigemAcao;
  fluxo_n8n?: string;
  etapa_cadencia?: number;
  cadencia_id?: string;
  resultado: 'enviado' | 'sem_resposta' | 'erro_entrega' | 'bounce';
}

export interface Resposta {
  id: string;
  empresa_id: string;
  abordagem_id: string;
  data: string;
  tipo:
    | 'interesse_positivo'
    | 'pediu_mais_info'
    | 'sem_interesse_agora'
    | 'nao_e_o_decisor'
    | 'pedir_recontato'
    | 'negativa_definitiva'
    | 'opt_out';
  conteudo: string;
  detectado_por: OrigemAcao;
}

export interface FollowUp {
  id: string;
  empresa_id: string;
  data_prevista: string;
  tipo_acao: 'enviar_mensagem' | 'ligar' | 'reativar' | 'enviar_material' | 'aguardar';
  canal_previsto: Canal;
  responsavel: string;
  observacao?: string;
  status: 'pendente' | 'realizado' | 'atrasado' | 'cancelado';
  origem: 'manual' | 'cadencia_automatica';
  cadencia_id?: string;
  etapa_cadencia?: number;
}

export interface BlacklistEntry {
  id: string;
  tipo: 'empresa' | 'contato' | 'dominio';
  referencia_id: string;
  motivo: 'opt_out_lgpd' | 'concorrente' | 'sem_fit' | 'pedido_direto' | 'outro';
  data: string;
  adicionado_por: string;
}

export interface WebhookLog {
  id: string;
  evento: string;
  empresa_id?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  status: 'disparado' | 'simulado' | 'erro';
}

export type TimelineEntry =
  | { kind: 'abordagem'; item: Abordagem; date: string }
  | { kind: 'resposta'; item: Resposta; date: string }
  | { kind: 'followup'; item: FollowUp; date: string }
  | { kind: 'webhook'; item: WebhookLog; date: string };
