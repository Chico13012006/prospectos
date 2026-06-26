'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, Loader2 } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { getNovosLeads } from '@/lib/api'
import type { GlobalFilterState } from './GlobalFilters'
import LeadCardCompact from './LeadCardCompact'

const PAGE = 50

const OPCOES_DATA = [
  { label: 'Últimos 30 dias', dias: 30 },
  { label: 'Últimos 90 dias', dias: 90 },
  { label: 'Todo o período', dias: 0 },
]

// Coluna "Novos Leads" = RESERVATÓRIO. Trata como fila: contador do total,
// filtro de data (default 30 dias), busca e consulta no servidor com
// limite/paginação + scroll infinito. NUNCA carrega todos de uma vez.
export default function ReservoirColumn({
  stage,
  filtros,
  selectedId,
  onSelect,
}: {
  stage: { label: string; color: string }
  filtros: GlobalFilterState
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const offsetRef = useRef(0)
  const carregandoRef = useRef(false)
  const parentRef = useRef<HTMLDivElement>(null)

  const desde = dias > 0 ? new Date(Date.now() - dias * 86400000).toISOString() : null
  const buscaEfetiva = busca.trim() || filtros.search.trim()

  const carregar = useCallback(
    async (reset: boolean) => {
      if (carregandoRef.current) return
      carregandoRef.current = true
      setLoading(true)
      const offset = reset ? 0 : offsetRef.current
      const { data: page, total: t } = await getNovosLeads({
        desde,
        busca: buscaEfetiva,
        responsavel: filtros.responsavel || undefined,
        segmento: filtros.segmento || undefined,
        canal: filtros.canal || undefined,
        limit: PAGE,
        offset,
      })
      setTotal(t)
      setData((prev) => (reset ? page : [...prev, ...page]))
      offsetRef.current = offset + page.length
      setLoading(false)
      carregandoRef.current = false
    },
    [desde, buscaEfetiva, filtros.responsavel, filtros.segmento, filtros.canal],
  )

  // Recarrega do zero quando muda data/busca/filtros (debounce p/ a busca).
  useEffect(() => {
    const t = setTimeout(() => carregar(true), 250)
    return () => clearTimeout(t)
  }, [carregar])

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 8,
  })

  const onScroll = () => {
    const el = parentRef.current
    if (!el || carregandoRef.current || data.length >= total) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) carregar(false)
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0">
      {/* Cabeçalho: título + total (servidor) */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-slate-300 leading-tight truncate">{stage.label}</span>
        </div>
        <span className="text-xs font-bold text-slate-500 bg-[#252b3b] px-2 py-0.5 rounded-full shrink-0" title="total no reservatório">
          {total.toLocaleString('pt-BR')}
        </span>
      </div>

      {/* Filtro de data */}
      <select
        value={dias}
        onChange={(e) => setDias(Number(e.target.value))}
        className="mb-1.5 shrink-0 text-xs border border-[#2a3147] rounded-lg px-2 py-1.5 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
      >
        {OPCOES_DATA.map((o) => (
          <option key={o.dias} value={o.dias}>{o.label}</option>
        ))}
      </select>

      {/* Busca (server-side) */}
      <div className="relative mb-2 shrink-0">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nesta etapa"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-[#2a3147] rounded-lg bg-[#1a1f2e] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {/* Lista virtualizada + scroll infinito */}
      <div
        ref={parentRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-[#0f1117]/40 border border-[#2a3147]/40 p-1.5"
      >
        {data.length === 0 && !loading ? (
          <div className="text-center text-xs text-slate-600 py-6">
            {buscaEfetiva ? 'Nada encontrado.' : 'Sem leads no período.'}
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
                    <LeadCardCompact lead={lead} selected={selectedId === lead.id} onClick={() => onSelect(lead.id)} />
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
