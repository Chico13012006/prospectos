import type { StatusLead, OrigemAcao, EstagioPipeline } from './types';

export const TODAY = '2026-06-16';

export const SDRS = ['Francisco', 'Silmara'] as const;

export const ESTAGIOS_PIPELINE: EstagioPipeline[] = [
  'novos_leads', 'primeiro_contato', 'aguardando_resposta', 'follow_up', 'interessado', 'reuniao_agendada',
];

export function getEstagioPipelineLabel(estagio: EstagioPipeline): string {
  const labels: Record<EstagioPipeline, string> = {
    novos_leads: 'Novos Leads',
    primeiro_contato: 'Primeiro Contato Enviado',
    aguardando_resposta: 'Aguardando Resposta',
    follow_up: 'Follow-up',
    interessado: 'Interessado',
    reuniao_agendada: 'Reunião Agendada',
  };
  return labels[estagio];
}

export function getStatusLabel(status: StatusLead): string {
  const labels: Record<StatusLead, string> = {
    novo: 'Novo',
    em_prospeccao: 'Em Prospecção',
    aguardando_resposta: 'Aguardando Resposta',
    respondeu_positivo: 'Respondeu Positivo',
    pediu_mais_info: 'Pediu Mais Info',
    sem_interesse_agora: 'Sem Interesse Agora',
    reativar_futuramente: 'Reativar Futuramente',
    descartado: 'Descartado',
    blacklist: 'Blacklist',
  };
  return labels[status];
}

export function getStatusBadgeClasses(status: StatusLead): string {
  const classes: Record<StatusLead, string> = {
    novo: 'bg-blue-100 text-blue-800 border border-blue-200',
    em_prospeccao: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
    aguardando_resposta: 'bg-amber-100 text-amber-800 border border-amber-200',
    respondeu_positivo: 'bg-green-100 text-green-800 border border-green-200',
    pediu_mais_info: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
    sem_interesse_agora: 'bg-orange-100 text-orange-800 border border-orange-200',
    reativar_futuramente: 'bg-purple-100 text-purple-800 border border-purple-200',
    descartado: 'bg-gray-100 text-gray-600 border border-gray-200',
    blacklist: 'bg-red-100 text-red-800 border border-red-200',
  };
  return classes[status];
}

export function getScoreColor(score: number): string {
  if (score >= 70) return '#22c55e';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.substring(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysSince(dateStr: string): number {
  const date = new Date(dateStr.substring(0, 10));
  const today = new Date(TODAY);
  return Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(dateStr: string): number {
  const date = new Date(dateStr.substring(0, 10));
  const today = new Date(TODAY);
  return Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function isOverdue(dateStr: string): boolean {
  return dateStr.substring(0, 10) < TODAY;
}

export function getOrigemIcon(origem: OrigemAcao): string {
  return origem === 'automatico' ? '🤖' : '👤';
}

export function getOrigemLabel(origem: OrigemAcao): string {
  return origem === 'automatico' ? 'Automático' : 'Humano';
}

export function getCanalBadgeClasses(canal: string): string {
  const colors: Record<string, string> = {
    LinkedIn: 'bg-blue-100 text-blue-700',
    Email: 'bg-gray-100 text-gray-700',
    WhatsApp: 'bg-green-100 text-green-700',
    Telefone: 'bg-purple-100 text-purple-700',
  };
  return colors[canal] || 'bg-gray-100 text-gray-700';
}

export function getTipoRespostaLabel(tipo: string): string {
  const labels: Record<string, string> = {
    interesse_positivo: 'Interesse Positivo',
    pediu_mais_info: 'Pediu Mais Info',
    sem_interesse_agora: 'Sem Interesse Agora',
    nao_e_o_decisor: 'Não é o Decisor',
    pedir_recontato: 'Pediu Recontato',
    negativa_definitiva: 'Negativa Definitiva',
    opt_out: 'Opt-out',
  };
  return labels[tipo] || tipo;
}

export function getTipoRespostaBadgeClasses(tipo: string): string {
  const classes: Record<string, string> = {
    interesse_positivo: 'bg-green-100 text-green-800',
    pediu_mais_info: 'bg-cyan-100 text-cyan-800',
    sem_interesse_agora: 'bg-orange-100 text-orange-800',
    nao_e_o_decisor: 'bg-yellow-100 text-yellow-800',
    pedir_recontato: 'bg-purple-100 text-purple-800',
    negativa_definitiva: 'bg-red-100 text-red-800',
    opt_out: 'bg-red-200 text-red-900',
  };
  return classes[tipo] || 'bg-gray-100 text-gray-700';
}

export function getTipoAcaoLabel(tipo: string): string {
  const labels: Record<string, string> = {
    enviar_mensagem: 'Enviar Mensagem',
    ligar: 'Ligar',
    reativar: 'Reativar',
    enviar_material: 'Enviar Material',
    aguardar: 'Aguardar',
  };
  return labels[tipo] || tipo;
}

export function clsx(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
