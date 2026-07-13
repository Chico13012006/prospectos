'use client'

// Skeleton reutilizável para blocos de gráfico/KPI/tabela enquanto os dados
// carregam. Usa CSS puro (sem framer-motion) — mais leve para algo que só
// pulsa — e respeita prefers-reduced-motion via .skeleton-pulse (globals.css).
export type SkeletonVariant = 'kpi' | 'chart' | 'donut' | 'table' | 'bars'

export default function LoadingSkeleton({
  variant = 'chart',
  rows = 4,
  height = 200,
  className = '',
}: {
  variant?: SkeletonVariant
  rows?: number
  height?: number
  className?: string
}) {
  const base = 'skeleton-pulse rounded-lg bg-[#232a3d]'

  if (variant === 'kpi') {
    return (
      <div className={`flex flex-col gap-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`${base} w-8 h-8 !rounded-lg`} />
            <div className={`${base} w-24 h-3.5`} />
          </div>
          <div className={`${base} w-10 h-4 !rounded-full`} />
        </div>
        <div className={`${base} w-16 h-7`} />
        <div className={`${base} w-full h-6`} />
      </div>
    )
  }

  if (variant === 'donut') {
    return (
      <div className={`flex items-center gap-6 ${className}`}>
        <div className={`${base} w-40 h-40 !rounded-full shrink-0`} />
        <div className="flex flex-col gap-2.5 flex-1">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className={`${base} h-4 w-full`} />
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`${base} h-8 w-full`} />
        ))}
      </div>
    )
  }

  if (variant === 'bars') {
    return (
      <div className={`grid grid-cols-2 gap-2.5 ${className}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`${base} h-16 w-full`} />
        ))}
      </div>
    )
  }

  // 'chart' — bloco único, altura configurável
  return <div className={`${base} w-full ${className}`} style={{ height }} />
}
