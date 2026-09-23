'use client'

import { Check } from 'lucide-react'

// Caixa de seleção no tema escuro: o <input> nativo continua lá (teclado,
// leitor de tela, form), só a aparência é nossa.
export default function CaixaSelecao({
  marcado, onChange, desabilitado = false, rotulo,
}: { marcado: boolean; onChange: () => void; desabilitado?: boolean; rotulo?: string }) {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0">
      <input
        type="checkbox"
        checked={marcado}
        disabled={desabilitado}
        onChange={onChange}
        aria-label={rotulo}
        className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border border-[var(--border-strong)] bg-[var(--bg-input)] transition-colors hover:border-indigo-400 checked:border-[var(--accent)] checked:bg-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-transparent disabled:hover:border-[var(--border-subtle)] focus-ring"
      />
      <Check size={12} strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto text-white opacity-0 transition-opacity peer-checked:opacity-100" />
    </span>
  )
}
