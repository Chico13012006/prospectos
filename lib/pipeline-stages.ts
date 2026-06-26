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
