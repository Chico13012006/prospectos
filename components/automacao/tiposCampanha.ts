// Tipos e helpers compartilhados de Campanha (client-safe — sem server-only).
// A fonte da verdade é a tabela `campanhas` (migration 0023): colunas + `publico`
// jsonb. Nada aqui inventa dado — só molda o que já existe/persiste.

export interface PublicoEmpresas {
  fonte?: string;            // 'base' (real) | 'maps' (externa, não configurada)
  pais?: string;
  segmento?: string;
  cidades?: string;
  limite?: number;
  removerDuplicados?: boolean;
  exigirSite?: boolean;
}
export interface PublicoDecisores {
  departamento?: string;
  cargos?: string;
  senioridade?: string;
  maxPorEmpresa?: number;
  exigirEmail?: boolean;
  exigirTelefone?: boolean;
}
export interface PublicoAgenda {
  diasSemana?: string[];   // ['seg','ter','qua','qui','sex']
  horarioInicio?: string;  // 'HH:MM'
  horarioFim?: string;     // 'HH:MM'
  limiteDiario?: number;
  pararAoResponder?: boolean;
}

export interface Publico {
  objetivo?: string;
  responsavel?: string;    // legado — preferir responsavel_id
  responsavel_id?: string;
  idioma?: string;
  prazo?: string;
  empresas?: PublicoEmpresas;
  decisores?: PublicoDecisores;
  agenda?: PublicoAgenda;
}

export interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: string | null;
  status: string;
  workflow_id: string | null;
  publico: Publico | null;
  meta_leads: number | null;
  dry_run: boolean | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export const STATUS_BADGE: Record<string, string> = {
  rascunho: 'bg-slate-500/15 text-slate-400',
  ativa: 'bg-green-500/15 text-green-400',
  pausada: 'bg-amber-500/15 text-amber-400',
  concluida: 'bg-indigo-500/15 text-indigo-300',
};

export const STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída',
};

export function brl(v: number): string {
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${v}`; }
}

export function fmtData(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}

// Resumo textual do público (para tabela/detalhe), a partir do publico jsonb.
export function resumoPublico(p: Publico | null): string {
  if (!p?.empresas) return 'Base existente';
  const e = p.empresas;
  const partes = [e.segmento, e.cidades, e.pais].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'Base existente';
}
