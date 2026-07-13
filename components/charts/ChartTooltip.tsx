'use client'

// Tooltip customizado para os gráficos Recharts do app. Passar via
// `<Tooltip content={<ChartTooltip formatter={...} />} />`. Tipagem propositalmente
// solta (o Recharts injeta active/payload/label em runtime via clone do elemento).
export interface ChartTooltipPayloadItem {
  name?: string
  value?: number | string
  color?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: ChartTooltipPayloadItem[]
  label?: string | number
  // Formata o valor de cada série. Recebe o item bruto do payload.
  formatter?: (item: ChartTooltipPayloadItem) => string
  // Formata o título (label do eixo X) do tooltip.
  labelFormatter?: (label: string | number) => string
}

function defaultFormatValue(item: ChartTooltipPayloadItem): string {
  const v = item.value
  if (typeof v === 'number') return v.toLocaleString('pt-BR')
  return v == null ? '—' : String(v)
}

export default function ChartTooltip({ active, payload, label, formatter, labelFormatter }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-[#2a3147] bg-[#161b28]/95 backdrop-blur-sm px-3.5 py-2.5 shadow-xl shadow-black/40 min-w-[150px]">
      {label !== undefined && (
        <div className="text-[11px] font-semibold text-slate-300 mb-1.5 pb-1.5 border-b border-[#2a3147]">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-slate-400 flex-1 whitespace-nowrap">{item.name}</span>
            <span className="font-semibold text-slate-100 tabular-nums">
              {formatter ? formatter(item) : defaultFormatValue(item)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
