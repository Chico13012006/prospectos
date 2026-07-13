'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import LoadingSkeleton, { type SkeletonVariant } from './LoadingSkeleton'
import EmptyState from './EmptyState'

// Card padrão para blocos de gráfico/tabela do Dashboard. Cuida de 3 estados
// (loading / vazio / conteúdo) animando a entrada de cada um com o CSS
// .animate-in já existente (globals.css) — a `key` força remount na troca de
// estado para a animação tocar de novo; prefers-reduced-motion é respeitado
// pela própria classe. Mantém o card visual já usado no resto do app
// (bg-[#1a1f2e], borda, hover com elevação).
export default function ChartContainer({
  title,
  icon: Icon,
  iconColor = 'text-indigo-500',
  loading = false,
  empty = false,
  emptyTitle,
  emptyDescription,
  skeletonVariant = 'chart',
  skeletonHeight,
  skeletonRows,
  action,
  className = '',
  bodyClassName = '',
  children,
}: {
  title: string
  icon?: LucideIcon
  iconColor?: string
  loading?: boolean
  empty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  skeletonVariant?: SkeletonVariant
  skeletonHeight?: number
  skeletonRows?: number
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <div className={`bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5 card-hover ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-200 flex items-center gap-2">
          {Icon && <Icon size={16} className={iconColor} />}
          {title}
        </h2>
        {action}
      </div>

      {loading ? (
        <div key="loading">
          <LoadingSkeleton variant={skeletonVariant} height={skeletonHeight} rows={skeletonRows} />
        </div>
      ) : empty ? (
        <div key="empty" className="animate-in">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div key="content" className={`animate-in ${bodyClassName}`}>
          {children}
        </div>
      )}
    </div>
  )
}
