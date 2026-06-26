'use client'

import { useRef, useState, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import LeadCardCompact from './LeadCardCompact'

// Uma coluna INDEPENDENTE do Kanban: cabeçalho + busca própria (filtra só esta
// etapa) + lista VIRTUALIZADA com scroll interno (rola só os leads daqui).
export default function KanbanColumn({
  stage,
  leads,
  respostaPendenteIds,
  selectedId,
  onSelect,
}: {
  stage: { id: string; label: string; color: string }
  leads: Lead[]
  respostaPendenteIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const parentRef = useRef<HTMLDivElement>(null)

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return leads
    return leads.filter((l) =>
      [l.empresa, l.contato_nome, l.contato_email, l.segmento, l.cidade]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t)),
    )
  }, [leads, q])

  const virtualizer = useVirtualizer({
    count: filtrados.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 96,
    overscan: 8,
  })

  return (
    <div className="flex flex-col h-full w-72 shrink-0">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
          <span className="text-sm font-semibold text-slate-300 leading-tight truncate">{stage.label}</span>
        </div>
        <span className="text-xs font-bold text-slate-500 bg-[#252b3b] px-2 py-0.5 rounded-full shrink-0">
          {filtrados.length}
        </span>
      </div>

      {/* Busca SÓ nesta etapa */}
      <div className="relative mb-2 shrink-0">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nesta etapa"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-[#2a3147] rounded-lg bg-[#1a1f2e] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      {/* Lista virtualizada com scroll interno */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-[#0f1117]/40 border border-[#2a3147]/40 p-1.5"
      >
        {filtrados.length === 0 ? (
          <div className="text-center text-xs text-slate-600 py-6">
            {q ? 'Nada encontrado nesta etapa.' : 'Sem leads.'}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const lead = filtrados[vi.index]
              return (
                <div
                  key={lead.id}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                >
                  <LeadCardCompact
                    lead={lead}
                    respostaPendente={respostaPendenteIds.has(lead.id)}
                    selected={selectedId === lead.id}
                    onClick={() => onSelect(lead.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
