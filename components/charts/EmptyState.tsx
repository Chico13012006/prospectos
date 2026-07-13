'use client'

import { Inbox, type LucideIcon } from 'lucide-react'

// Estado vazio padrão para blocos de gráfico/tabela sem dados. Discreto,
// consistente com o visual azul/índigo do resto do app.
export default function EmptyState({
  icon: Icon = Inbox,
  title = 'Sem dados para este período',
  description,
  className = '',
}: {
  icon?: LucideIcon
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-10 gap-2 ${className}`}>
      <div className="w-10 h-10 rounded-full bg-[#232a3d] flex items-center justify-center mb-1">
        <Icon size={18} className="text-slate-500" />
      </div>
      <p className="text-sm font-medium text-slate-400">{title}</p>
      {description && <p className="text-xs text-slate-600 max-w-[240px]">{description}</p>}
    </div>
  )
}
