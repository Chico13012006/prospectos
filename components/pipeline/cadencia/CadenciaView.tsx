'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { getLeadsPorEstagioPaginado } from '@/lib/api'
import { ESTAGIOS_CADENCIA, labelProximaAcao } from '@/lib/pipeline-stages'
import type { Lead } from '@/lib/supabase'
import type { GlobalFilterState } from '@/components/pipeline/GlobalFilters'
import styles from './CadenciaView.module.css'

const PAGE_SIZE = 50

type CadenciaStage = {
  id: string
  label: string
  description: string
  color: string
  estagios: string[]
  followups?: number | { gte: number }
  kind: 'contato' | 'followup' | 'respondeu'
}

const CADENCIA_STAGES: CadenciaStage[] = [
  { id: 'contato1', label: '1º contato', description: 'Primeiro contato enviado', color: '#4f7cff', estagios: ESTAGIOS_CADENCIA, followups: 0, kind: 'contato' },
  { id: 'followup1', label: '1º Follow-up', description: 'Aguardando retorno', color: '#7c3aed', estagios: ESTAGIOS_CADENCIA, followups: 1, kind: 'followup' },
  { id: 'followup2', label: '2º Follow-up', description: 'Segundo contato enviado', color: '#4f7cff', estagios: ESTAGIOS_CADENCIA, followups: 2, kind: 'followup' },
  { id: 'followup3', label: '3º Follow-up', description: 'Terceiro contato enviado', color: '#9333ea', estagios: ESTAGIOS_CADENCIA, followups: 3, kind: 'followup' },
  { id: 'followup4', label: '4º Follow-up', description: 'Última tentativa', color: '#7c3aed', estagios: ESTAGIOS_CADENCIA, followups: { gte: 4 }, kind: 'followup' },
  { id: 'respondeu', label: 'Respondeu', description: 'Teve uma resposta', color: '#22c55e', estagios: ['interessado', 'respondeu', 'com_closer'], kind: 'respondeu' },
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
  lead: Lead
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

function CadenciaColumn({ stage, filters, selectedId, onSelect, reloadKey, onTotalChange }: {
  stage: CadenciaStage
  filters: GlobalFilterState
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
  onTotalChange: (stageId: string, total: number) => void
}) {
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const offsetRef = useRef(0)
  const loadingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const offset = reset ? 0 : offsetRef.current

    try {
      const result = await getLeadsPorEstagioPaginado(
        stage.estagios,
        {
          busca: filters.search.trim(),
          responsavel: filters.responsavel || undefined,
          segmento: filters.segmento || undefined,
          canal: filters.canal || undefined,
          followups: stage.followups,
        },
        { limit: PAGE_SIZE, offset, ordenarPor: 'ultimo_contato' },
      )
      setTotal(result.total)
      onTotalChange(stage.id, result.total)
      setData((current) => reset ? result.data : [...current, ...result.data])
      offsetRef.current = offset + result.data.length
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [filters.canal, filters.responsavel, filters.search, filters.segmento, onTotalChange, stage.estagios, stage.followups, stage.id])

  useEffect(() => {
    const timeout = setTimeout(() => load(true), 250)
    return () => clearTimeout(timeout)
  }, [load, reloadKey])

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 159,
    overscan: 7,
  })

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element || loadingRef.current || data.length >= total) return
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 260) load(false)
  }

  const StageIcon = stage.kind === 'respondeu' ? CheckCircle2 : stage.kind === 'contato' ? Send : Mail

  return (
    <section className={styles.column} aria-labelledby={`cadencia-${stage.id}`}>
      <header className={styles.columnHeader}>
        <div className={styles.columnTitleRow}>
          <div className={styles.columnTitle}>
            <StageIcon size={16} style={{ color: stage.color }} aria-hidden="true" />
            <h2 id={`cadencia-${stage.id}`}>{stage.label}</h2>
          </div>
          <span className={styles.count}>{total.toLocaleString('pt-BR')}</span>
        </div>
        <p>{stage.description}</p>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className={styles.columnBody}>
        {data.length === 0 && !loading ? (
          <div className={styles.empty}>{filters.search ? 'Nenhum contato encontrado.' : 'Nenhum contato nesta etapa.'}</div>
        ) : (
          <div className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const lead = data[item.index]
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
        {loading ? <div className={styles.loadingMore}><Loader2 size={13} className={styles.spinner} /> Carregando...</div> : null}
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
  const [totals, setTotals] = useState<Record<string, number>>({})

  const updateTotal = useCallback((stageId: string, total: number) => {
    setTotals((current) => current[stageId] === total ? current : { ...current, [stageId]: total })
  }, [])

  const visibleStages = useMemo(
    () => stageFilter ? CADENCIA_STAGES.filter((stage) => stage.id === stageFilter) : CADENCIA_STAGES,
    [stageFilter],
  )
  const total = visibleStages.reduce((sum, stage) => sum + (totals[stage.id] ?? 0), 0)
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
        {loading ? (
          <div className={styles.pageState}><Loader2 size={18} className={styles.spinner} /> Carregando contatos...</div>
        ) : !usingSupabase ? (
          <div className={styles.pageState}>Não foi possível carregar os dados da Pipeline.</div>
        ) : (
          <div className={`${styles.board} ${visibleStages.length === 1 ? styles.boardSingle : ''}`}>
            {visibleStages.map((stage) => (
              <CadenciaColumn
                key={stage.id}
                stage={stage}
                filters={filtros}
                selectedId={selectedId}
                onSelect={onSelect}
                reloadKey={reloadKey}
                onTotalChange={updateTotal}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
