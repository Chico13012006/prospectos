'use client'

import { Search, X } from 'lucide-react'

export interface GlobalFilterState {
  search: string
  responsavel: string
  segmento: string
  canal: string
}

// Filtros GLOBAIS — aplicam-se a TODO o pipeline (antes de dividir por coluna).
export default function GlobalFilters({
  value,
  onChange,
  responsaveis,
  segmentos,
  canais,
}: {
  value: GlobalFilterState
  onChange: (v: GlobalFilterState) => void
  responsaveis: string[]
  segmentos: string[]
  canais: string[]
}) {
  const set = (patch: Partial<GlobalFilterState>) => onChange({ ...value, ...patch })
  const temFiltro = value.search || value.responsavel || value.segmento || value.canal

  const selectCls =
    'text-sm border border-[#2a3147] rounded-lg px-2.5 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Buscar em todo o pipeline..."
          className="pl-8 pr-3 py-2 text-sm border border-[#2a3147] rounded-lg bg-[#1a1f2e] text-slate-300 placeholder:text-slate-600 w-60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
      </div>

      <select value={value.responsavel} onChange={(e) => set({ responsavel: e.target.value })} className={selectCls}>
        <option value="">Todos os responsáveis</option>
        {responsaveis.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      <select value={value.segmento} onChange={(e) => set({ segmento: e.target.value })} className={selectCls}>
        <option value="">Todos os segmentos</option>
        {segmentos.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select value={value.canal} onChange={(e) => set({ canal: e.target.value })} className={selectCls}>
        <option value="">Todos os canais</option>
        {canais.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {temFiltro && (
        <button
          onClick={() => onChange({ search: '', responsavel: '', segmento: '', canal: '' })}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-2"
        >
          <X size={13} /> Limpar
        </button>
      )}
    </div>
  )
}
