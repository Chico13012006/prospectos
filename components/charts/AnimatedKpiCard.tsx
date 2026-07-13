'use client'

import { useEffect, useRef, useState } from 'react'
// framer-motion só para o count-up do valor (insubstituível por CSS); a
// animação de entrada do card usa o .animate-in do globals.css.
import { useReducedMotion, animate } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import LoadingSkeleton from './LoadingSkeleton'

// KPI card com contagem animada do valor, sparkline e hover com leve elevação
// (herdado de .card-hover, já usado em todo o app). Usado nos 5 cards do topo
// do Dashboard.
export default function AnimatedKpiCard({
  label,
  value,
  delta,
  icon: Icon,
  color = '#6366f1',
  iconColor = 'text-indigo-400',
  iconBg = 'bg-indigo-500/20',
  sparkline,
  loading = false,
  className = '',
}: {
  label: string
  value: number
  delta?: string
  icon: LucideIcon
  color?: string
  iconColor?: string
  iconBg?: string
  /** Pontos normalizados 0-100 (opcional). Sem eles usa uma curva padrão discreta. */
  sparkline?: number[]
  loading?: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = useState(0)
  const prevValue = useRef(0)

  useEffect(() => {
    if (loading) return
    if (reduceMotion) {
      setDisplay(value)
      prevValue.current = value
      return
    }
    const controls = animate(prevValue.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    prevValue.current = value
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loading, reduceMotion])

  if (loading) {
    return (
      <div className={`card p-5 ${className}`}>
        <LoadingSkeleton variant="kpi" />
      </div>
    )
  }

  const gid = `spark-${label.replace(/[^a-zA-Z0-9]/g, '')}`
  const points = sparkline && sparkline.length > 1 ? sparkline : [82, 78, 80, 60, 68, 40, 46]
  const w = 100
  const stepX = w / (points.length - 1)
  const toXY = (v: number, i: number) => `${i * stepX},${24 - (Math.max(0, Math.min(100, v)) / 100) * 20}`
  const line = points.map(toXY).join(' ')
  const area = `${line} ${w},24 0,24`

  return (
    <div className={`card card-hover p-5 flex flex-col gap-3 animate-in ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icon size={16} className={iconColor} />
          </div>
          <span className="text-sm text-slate-400">{label}</span>
        </div>
        {delta && (
          <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
            {delta}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-slate-100 tabular-nums">{display.toLocaleString('pt-BR')}</div>
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-6">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={area} fill={`url(#${gid})`} stroke="none" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
