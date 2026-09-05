'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Briefcase, Calculator, Sparkles, FileText } from 'lucide-react';
import SimuladorPanel from '@/components/comercial/SimuladorPanel';
import CopilotoPanel from '@/components/comercial/CopilotoPanel';
import TemplatesPanel from '@/components/templates/TemplatesPanel';

// Módulo "Comercial": junta o Simulador de propostas, o Copiloto pós-reunião e
// a biblioteca de Templates em abas internas (?tab=simulador|copiloto|templates),
// um único item na navegação. O TemplatesPanel é o mesmo usado em
// Automação > Modelos — painel compartilhado, não uma segunda cópia.
// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function ComercialPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'simulador' | 'copiloto' | 'templates';

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('simulador');

  // Deep-link: ?tab=copiloto|simulador|templates (nav, redirect de /templates
  // ou link externo). O simulador também lê ?modelo/?itens (vindo do copiloto).
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'copiloto' || tab === 'simulador' || tab === 'templates') setAba(tab);
  }, [searchParams]);

  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Briefcase size={22} className="text-indigo-400" /> Comercial
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Propostas, copiloto pós-reunião e biblioteca de templates.
        </p>
      </div>

      {/* Abas: Simulador · Copiloto · Templates */}
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit animate-in stagger-2">
        {([
          { id: 'simulador', label: 'Simulador', Icon: Calculator },
          { id: 'copiloto', label: 'Copiloto', Icon: Sparkles },
          { id: 'templates', label: 'Templates', Icon: FileText },
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
        {aba === 'simulador' && <SimuladorPanel />}
        {aba === 'copiloto' && <CopilotoPanel />}
        {aba === 'templates' && <TemplatesPanel />}
      </div>
    </div>
  );
}
