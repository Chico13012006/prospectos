// Fonte ÚNICA do agrupamento: estágios internos do motor → colunas do board.
// Usado pela UI e pelas queries. Não renomeia estágios; só agrupa na exibição.

export type ColunaId = 'novos' | 'prospeccao' | 'respondeu' | 'reuniao' | 'ganho'

export interface ColunaDef {
  id: ColunaId
  label: string
  color: string
  estagios: string[]
  tipo: 'reservatorio' | 'tempo_real'
}

export const COLUNAS: ColunaDef[] = [
  { id: 'novos', label: 'Novos Leads', color: '#6366f1', estagios: ['novo', 'novos_leads'], tipo: 'reservatorio' },
  { id: 'prospeccao', label: 'Em Prospecção', color: '#3b82f6', estagios: ['primeiro_contato', 'aguardando_resposta', 'follow_up', 'follow_up_1', 'follow_up_2'], tipo: 'tempo_real' },
  { id: 'respondeu', label: 'Respondeu', color: '#22c55e', estagios: ['interessado', 'respondeu', 'com_closer'], tipo: 'tempo_real' },
  { id: 'reuniao', label: 'Reunião Agendada', color: '#8b5cf6', estagios: ['reuniao_agendada'], tipo: 'tempo_real' },
  { id: 'ganho', label: 'Ganho', color: '#10b981', estagios: ['ganho'], tipo: 'tempo_real' },
]

// Estágios do reservatório (Novos Leads) e do board de tempo real.
export const ESTAGIOS_RESERVATORIO = COLUNAS.find(c => c.id === 'novos')!.estagios
export const ESTAGIOS_TEMPO_REAL = COLUNAS.filter(c => c.tipo === 'tempo_real').flatMap(c => c.estagios)

// --- VISÃO "CADÊNCIA DE FOLLOW-UP" ---------------------------------------
// Mesmos leads do board, AGRUPADOS por número de follow-up enviado. NÃO altera
// estágios do motor: as 4 primeiras colunas filtram os estágios em cadência +
// o cache `followups_enviados` (migration 0003); as 2 últimas agrupam por
// estágio puro. Chip do card: status da etapa.

// Estágios em que o lead está na esteira de follow-up (mesmo conjunto da coluna
// "Em Prospecção" do comercial).
export const ESTAGIOS_CADENCIA = COLUNAS.find(c => c.id === 'prospeccao')!.estagios

export type ChipCadencia = 'enviado' | 'respondeu' | 'sem_resposta'

export interface ColunaCadenciaDef {
  id: string
  label: string
  color: string
  estagios: string[]
  // Filtro por nº de follow-ups: exato (1,2,3) ou cap ({ gte: 4 }). Ausente nas
  // colunas que agrupam só por estágio (Respondeu / Sem Resposta).
  followups?: number | { gte: number }
  chip: ChipCadencia
}

export const COLUNAS_CADENCIA: ColunaCadenciaDef[] = [
  { id: 'fup1', label: '1º Follow-up', color: '#3b82f6', estagios: ESTAGIOS_CADENCIA, followups: 1, chip: 'enviado' },
  { id: 'fup2', label: '2º Follow-up', color: '#6366f1', estagios: ESTAGIOS_CADENCIA, followups: 2, chip: 'enviado' },
  { id: 'fup3', label: '3º Follow-up', color: '#8b5cf6', estagios: ESTAGIOS_CADENCIA, followups: 3, chip: 'enviado' },
  { id: 'fup4', label: '4º Follow-up', color: '#a855f7', estagios: ESTAGIOS_CADENCIA, followups: { gte: 4 }, chip: 'enviado' },
  { id: 'cad_respondeu', label: 'Respondeu no Follow-up', color: '#22c55e', estagios: ['interessado', 'respondeu', 'com_closer'], chip: 'respondeu' },
  { id: 'cad_sem_resposta', label: 'Sem Resposta / Reativar', color: '#94a3b8', estagios: ['sem_resposta'], chip: 'sem_resposta' },
]

// Terminais fora do board (acessíveis por filtro).
export const OFFBOARD = {
  perdido: { label: 'Perdido', estagio: 'perdido' as const },
  sem_resposta: { label: 'Sem resposta', estagio: 'sem_resposta' as const },
}
export type OffboardId = keyof typeof OFFBOARD

// Estágios-alvo que o CLOSER pode setar manualmente (de "Respondeu" em diante).
// O motor NUNCA seta estes — é movimentação humana.
export const ESTAGIOS_MANUAIS: { value: string; label: string }[] = [
  { value: 'interessado', label: 'Respondeu' },
  { value: 'reuniao_agendada', label: 'Reunião Agendada' },
  { value: 'ganho', label: 'Ganho' },
  { value: 'perdido', label: 'Perdido' },
]
