'use client'

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, Loader2 } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { getLeadsPorEstagioPaginado } from '@/lib/api'
import type { ColunaDef } from '@/lib/pipeline-stages'
import type { GlobalFilterState } from './GlobalFilters'
import LeadCardCompact from './LeadCardCompact'

const PAGE = 50

const OPCOES_DATA = [
  { label: 'Últimos 30 dias', dias: 30 },
  { label: 'Últimos 90 dias', dias: 90 },
  { label: 'Todo o período', dias: 0 },
]

// "Resposta a tratar": o motor grava estes sinais em proxima_acao quando um lead
// responde. Calculado POR CARD (não dependemos mais de ter a coluna inteira em
// memória), o que mantém o board leve a 10k+ leads.
const RESPOSTA_PENDENTE = new Set(['aguardando_closer', 'com_closer'])
const temRespostaPendente = (l: Lead) => !!l.proxima_acao && RESPOSTA_PENDENTE.has(l.proxima_acao)

// Coluna ESCALÁVEL e independente do board: contador com TOTAL REAL (COUNT no
// servidor), fetch paginado por estágio (range), scroll infinito em lotes e
// lista virtualizada. NUNCA busca todos os leads da coluna de uma vez. Os
// filtros globais aplicam server-side; `comFiltroData` liga o filtro de data
// usado só no reservatório "Novos Leads".
export default function PipelineColumn({
  stage,
  filtros,
  selectedId,
  onSelect,
  reloadKey,
  comFiltroData = false,
}: {
  stage: ColunaDef
  filtros: GlobalFilterState
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
  comFiltroData?: boolean
}) {
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const offsetRef = useRef(0)
  const carregandoRef = useRef(false)
  const parentRef = useRef<HTMLDivElement>(null)

  // Busca local da etapa OU busca global (a que estiver preenchida).
  const buscaEfetiva = busca.trim() || filtros.search.trim()
  // Memoizado por `dias`: senão o timestamp mudaria a cada render, recriando
  // `carregar` e disparando re-fetch em loop.
  const desde = useMemo(
    () => (comFiltroData && dias > 0 ? new Date(Date.now() - dias * 86400000).toISOString() : null),
    [comFiltroData, dias],
  )

  const carregar = useCallback(
    async (reset: boolean) => {
      if (carregandoRef.current) return
      carregandoRef.current = true
      setLoading(true)
      const offset = reset ? 0 : offsetRef.current
      const { data: page, total: t } = await getLeadsPorEstagioPaginado(
        stage.estagios,
        {
          desde,
          busca: buscaEfetiva,
          responsavel: filtros.responsavel || undefined,
          segmento: filtros.segmento || undefined,
          canal: filtros.canal || undefined,
        },
        { limit: PAGE, offset, ordenarPor: comFiltroData ? 'created_at' : 'ultimo_contato' },
      )
      setTotal(t)
      setData((prev) => (reset ? page : [...prev, ...page]))
      offsetRef.current = offset + page.length
      setLoading(false)
      carregandoRef.current = false
    },
    [stage.estagios, comFiltroData, desde, buscaEfetiva, filtros.responsavel, filtros.segmento, filtros.canal],
  )

  // Recarrega do zero quando muda data/busca/filtros (debounce p/ a busca) ou
  // quando o board é invalidado por uma mutação (reloadKey).
  useEffect(() => {
    const t = setTimeout(() => carregar(true), 250)
    return () => clearTimeout(t)
  }, [carregar, reloadKey])

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 8,
  })

  // Scroll infinito: ao chegar perto do fim, busca a próxima página.
  const onScroll = () => {
    const el = parentRef.current
    if (!el || carregandoRef.current || data.length >= total) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) carregar(false)
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0">
      {/* Cabeçalho: título + TOTAL REAL (COUNT do servidor) */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-slate-300 leading-tight truncate">{stage.label}</span>
        </div>
        <span className="text-xs font-bold text-slate-500 bg-[#252b3b] px-2 py-0.5 rounded-full shrink-0" title="total na etapa">
          {total.toLocaleString('pt-BR')}
        </span>
      </div>

      {/* Filtro de data (só no reservatório Novos Leads) */}
      {comFiltroData && (
        <select
          value={dias}
          onChange={(e) => setDias(Number(e.target.value))}
          className="mb-1.5 shrink-0 text-xs border border-[#2a3147] rounded-lg px-2 py-1.5 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        >
          {OPCOES_DATA.map((o) => (
            <option key={o.dias} value={o.dias}>{o.label}</option>
          ))}
        </select>
      )}

      {/* Busca (server-side) só nesta etapa */}
      <div className="relative mb-2 shrink-0">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nesta etapa"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-[#2a3147] rounded-lg bg-[#1a1f2e] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {/* Lista virtualizada + scroll infinito (altura fixa, rola só aqui) */}
      <div
        ref={parentRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-[#0f1117]/40 border border-[#2a3147]/40 p-1.5"
      >
        {data.length === 0 && !loading ? (
          <div className="text-center text-xs text-slate-600 py-6">
            {buscaEfetiva ? 'Nada encontrado nesta etapa.' : 'Sem leads.'}
          </div>
        ) : (
          <>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const lead = data[vi.index]
                return (
                  <div
                    key={lead.id}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  >
                    <LeadCardCompact
                      lead={lead}
                      respostaPendente={temRespostaPendente(lead)}
                      selected={selectedId === lead.id}
                      onClick={() => onSelect(lead.id)}
                    />
                  </div>
                )
              })}
            </div>
            {data.length < total && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500">
                {loading && <Loader2 size={12} className="animate-spin" />}
                {loading ? 'Carregando...' : `${data.length} de ${total.toLocaleString('pt-BR')}`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
