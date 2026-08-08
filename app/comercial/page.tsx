'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Briefcase, Calculator, Sparkles } from 'lucide-react';
import SimuladorPanel from '@/components/comercial/SimuladorPanel';
import CopilotoPanel from '@/components/comercial/CopilotoPanel';

// Módulo "Comercial": junta o Simulador de propostas e o Copiloto pós-reunião
// em abas internas (?tab=simulador|copiloto), um único item na navegação.
// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function ComercialPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'simulador' | 'copiloto';

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('simulador');

  // Deep-link: ?tab=copiloto abre a aba do copiloto (ex.: nav ou link externo).
  // O simulador também lê ?modelo/?itens (pré-preenchimento vindo do copiloto).
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'copiloto' || tab === 'simulador') setAba(tab);
  }, [searchParams]);

  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Briefcase size={22} className="text-indigo-400" /> Comercial
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Monte propostas e transforme reuniões em próximos passos com a IA.
        </p>
      </div>

      {/* Abas: Simulador · Copiloto */}
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit animate-in stagger-2">
        {([
          { id: 'simulador', label: 'Simulador', Icon: Calculator },
          { id: 'copiloto', label: 'Copiloto', Icon: Sparkles },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setAba(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors focus-ring ${
              aba === t.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <t.Icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <div className="animate-in stagger-3">
        {aba === 'simulador' ? <SimuladorPanel /> : <CopilotoPanel />}
      </div>
    </div>
  );
}
