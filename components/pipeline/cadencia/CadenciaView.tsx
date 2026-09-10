'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Columns3,
  List,
  Loader2,
  Mail,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { getLeadsCadencia, type EtapaCadencia, type LeadCadencia } from '@/lib/api'
import { labelProximaAcao } from '@/lib/pipeline-stages'
import type { GlobalFilterState } from '@/components/pipeline/GlobalFilters'
import styles from './CadenciaView.module.css'

type CadenciaStage = {
  id: EtapaCadencia
  label: string
  description: string
  color: string
  kind: 'contato' | 'followup' | 'respondeu'
}

// Colunas EXIBIDAS. A etapa é decidida em lib/api.ts (getLeadsCadencia) a partir
// da inscrição em `workflow_execucoes` + contagem de envios em `interacoes` —
// não de leads.estagio/followups_enviados. A etapa 'a_iniciar' (inscrito, nenhum
// envio ainda) já é classificada lá, mas ainda NÃO tem coluna aqui.
const CADENCIA_STAGES: CadenciaStage[] = [
  { id: 'contato1', label: '1º contato', description: 'Primeiro contato enviado', color: '#4f7cff', kind: 'contato' },
  { id: 'followup1', label: '1º Follow-up', description: 'Aguardando retorno', color: '#7c3aed', kind: 'followup' },
  { id: 'followup2', label: '2º Follow-up', description: 'Segundo contato enviado', color: '#4f7cff', kind: 'followup' },
  { id: 'followup3', label: '3º Follow-up', description: 'Terceiro contato enviado', color: '#9333ea', kind: 'followup' },
  { id: 'followup4', label: '4º Follow-up', description: 'Última tentativa', color: '#7c3aed', kind: 'followup' },
  { id: 'respondeu', label: 'Respondeu', description: 'Teve uma resposta', color: '#22c55e', kind: 'respondeu' },
]

function formatLastContact(value?: string | null): string {
  if (!value) return 'Nenhum envio registrado'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nenhum envio registrado'

  const today = new Date()
  const isToday = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (isToday) return `Hoje, ${time}`

  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date)
  return `${day}, ${time}`
}

function formatDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function initials(name?: string | null): string {
  if (!name) return ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function CadenciaLeadCard({ lead, stage, selected, onSelect }: {
  lead: LeadCadencia
  stage: CadenciaStage
  selected: boolean
  onSelect: () => void
}) {
  const owner = lead.usuarios?.nome ?? lead.responsavel_nome ?? null
  const nextDate = formatDate(lead.proxima_acao_data)
  const nextAction = labelProximaAcao(lead.proxima_acao)

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onSelect}
    >
      <strong className={styles.company}>{lead.empresa}</strong>
      <span className={styles.contact}>{lead.contato_nome || 'Contato não informado'}</span>

      <span
        className={styles.stageBadge}
        style={{ color: stage.color, backgroundColor: `${stage.color}22`, borderColor: `${stage.color}38` }}
      >
        {stage.label}
      </span>

      <span className={styles.cardMeta}>
        <Mail size={13} aria-hidden="true" />
        <span>{formatLastContact(lead.ultimo_contato)}</span>
      </span>
      <span className={styles.cardMeta}>
        <CalendarDays size={13} aria-hidden="true" />
        <span className={styles.nextAction}>
          {nextAction === '—' ? 'Sem próxima ação' : nextAction}
          {nextDate ? <small>{nextDate}</small> : null}
        </span>
        {owner ? <span className={styles.owner} title={owner}>{initials(owner)}</span> : null}
      </span>
    </button>
  )
}

// Coluna puramente de apresentação: recebe os leads já classificados pela etapa.
// A classificação e a busca vivem em CadenciaView (uma consulta para o board
// inteiro), porque a etapa não é mais um filtro que o banco saiba aplicar.
function CadenciaColumn({ stage, leads, buscando, selectedId, onSelect }: {
  stage: CadenciaStage
  leads: LeadCadencia[]
  buscando: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 159,
    overscan: 7,
  })

  const StageIcon = stage.kind === 'respondeu' ? CheckCircle2 : stage.kind === 'contato' ? Send : Mail

  return (
    <section className={styles.column} aria-labelledby={`cadencia-${stage.id}`}>
      <header className={styles.columnHeader}>
        <div className={styles.columnTitleRow}>
          <div className={styles.columnTitle}>
            <StageIcon size={16} style={{ color: stage.color }} aria-hidden="true" />
            <h2 id={`cadencia-${stage.id}`}>{stage.label}</h2>
          </div>
          <span className={styles.count}>{leads.length.toLocaleString('pt-BR')}</span>
        </div>
        <p>{stage.description}</p>
      </header>

      <div ref={scrollRef} className={styles.columnBody}>
        {leads.length === 0 ? (
          <div className={styles.empty}>{buscando ? 'Nenhum contato encontrado.' : 'Nenhum contato nesta etapa.'}</div>
        ) : (
          <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const lead = leads[item.index]
              return (
                <div
                  key={lead.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={styles.virtualItem}
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <CadenciaLeadCard
                    lead={lead}
                    stage={stage}
                    selected={selectedId === lead.id}
                    onSelect={() => onSelect(lead.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export default function CadenciaView({
  filtros,
  onFiltrosChange,
  responsaveis,
  segmentos,
  canais,
  selectedId,
  onSelect,
  reloadKey,
  loading,
  usingSupabase,
  onOpenList,
  onNovoContato,
}: {
  filtros: GlobalFilterState
  onFiltrosChange: (filters: GlobalFilterState) => void
  responsaveis: string[]
  segmentos: string[]
  canais: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
  loading: boolean
  usingSupabase: boolean
  onOpenList: () => void
  onNovoContato: () => void
}) {
  const [stageFilter, setStageFilter] = useState('')
  const [moreFilters, setMoreFilters] = useState(false)
  const [leads, setLeads] = useState<LeadCadencia[]>([])
  const [carregando, setCarregando] = useState(true)

  // Uma consulta para o board inteiro: a etapa depende de `workflow_execucoes` +
  // contagem em `interacoes`, então o banco não sabe filtrar por coluna. O
  // contador de requisição impede que uma resposta antiga (busca sendo digitada)
  // sobrescreva a mais recente.
  const requisicaoRef = useRef(0)
  useEffect(() => {
    const requisicao = ++requisicaoRef.current
    setCarregando(true)
    const timeout = setTimeout(async () => {
      try {
        const dados = await getLeadsCadencia({
          busca: filtros.search.trim(),
          responsavel: filtros.responsavel || undefined,
          segmento: filtros.segmento || undefined,
          canal: filtros.canal || undefined,
        })
        if (requisicao !== requisicaoRef.current) return
        setLeads(dados)
      } finally {
        if (requisicao === requisicaoRef.current) setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [filtros.search, filtros.responsavel, filtros.segmento, filtros.canal, reloadKey])

  const porEtapa = useMemo(() => {
    const grupos = new Map<EtapaCadencia, LeadCadencia[]>()
    for (const stage of CADENCIA_STAGES) grupos.set(stage.id, [])
    // Leads em etapa sem coluna (hoje só 'a_iniciar') simplesmente não entram —
    // ficam de fora até existir a coluna correspondente.
    for (const lead of leads) grupos.get(lead.etapa)?.push(lead)
    return grupos
  }, [leads])

  const visibleStages = useMemo(
    () => stageFilter ? CADENCIA_STAGES.filter((stage) => stage.id === stageFilter) : CADENCIA_STAGES,
    [stageFilter],
  )
  const total = visibleStages.reduce((sum, stage) => sum + (porEtapa.get(stage.id)?.length ?? 0), 0)
  const hasFilters = Boolean(filtros.search || filtros.responsavel || filtros.segmento || filtros.canal || stageFilter)

  const setFilters = (patch: Partial<GlobalFilterState>) => onFiltrosChange({ ...filtros, ...patch })
  const clearFilters = () => {
    onFiltrosChange({ search: '', responsavel: '', segmento: '', canal: '' })
    setStageFilter('')
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div className={styles.headingBlock}>
          <span className={styles.headingIcon}><BarChart3 size={20} /></span>
          <div>
            <h1>Pipeline de Contato</h1>
            <p>Acompanhe e gerencie o seu processo comercial.</p>
          </div>
        </div>
        <button type="button" className={styles.primaryButton} onClick={onNovoContato}>
          <Plus size={16} /> Novo contato
        </button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.viewRow}>
          <div className={styles.tabs} aria-label="Visualização da Pipeline">
            <button type="button" className={styles.tabActive} aria-pressed="true">
              <Columns3 size={15} /> Cadência
            </button>
            <button type="button" onClick={onOpenList} aria-pressed="false">
              <List size={15} /> Lista
            </button>
          </div>
          <span className={styles.total}><strong>{total.toLocaleString('pt-BR')}</strong> oportunidades</span>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>Buscar no pipeline</span>
            <input
              value={filtros.search}
              onChange={(event) => setFilters({ search: event.target.value })}
              placeholder="Buscar no pipeline..."
            />
          </label>

          <select value={filtros.responsavel} onChange={(event) => setFilters({ responsavel: event.target.value })} aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((responsavel) => <option key={responsavel} value={responsavel}>{responsavel}</option>)}
          </select>

          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} aria-label="Filtrar por etapa da cadência">
            <option value="">Todos os status</option>
            {CADENCIA_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>

          <select value={filtros.segmento} onChange={(event) => setFilters({ segmento: event.target.value })} aria-label="Filtrar por segmento">
            <option value="">Todos os segmentos</option>
            {segmentos.map((segmento) => <option key={segmento} value={segmento}>{segmento}</option>)}
          </select>

          <button
            type="button"
            className={`${styles.moreButton} ${moreFilters || filtros.canal ? styles.moreButtonActive : ''}`}
            onClick={() => setMoreFilters((open) => !open)}
            aria-expanded={moreFilters}
          >
            <SlidersHorizontal size={15} /> Mais filtros
          </button>

          {moreFilters ? (
            <select value={filtros.canal} onChange={(event) => setFilters({ canal: event.target.value })} aria-label="Filtrar por canal">
              <option value="">Todos os canais</option>
              {canais.map((canal) => <option key={canal} value={canal}>{canal}</option>)}
            </select>
          ) : null}

          {hasFilters ? (
            <button type="button" className={styles.clearButton} onClick={clearFilters}>
              <X size={14} /> Limpar
            </button>
          ) : null}
        </div>
      </div>

      <main className={styles.boardViewport}>
        {loading || carregando ? (
          <div className={styles.pageState}><Loader2 size={18} className={styles.spinner} /> Carregando contatos...</div>
        ) : !usingSupabase ? (
          <div className={styles.pageState}>Não foi possível carregar os dados da Pipeline.</div>
        ) : (
          <div className={`${styles.board} ${visibleStages.length === 1 ? styles.boardSingle : ''}`}>
            {visibleStages.map((stage) => (
              <CadenciaColumn
                key={stage.id}
                stage={stage}
                leads={porEtapa.get(stage.id) ?? []}
                buscando={Boolean(filtros.search)}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
