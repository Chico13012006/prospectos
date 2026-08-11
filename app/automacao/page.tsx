'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, Megaphone, Workflow, Layers, Activity } from 'lucide-react';
import CampanhasPanel from '@/components/automacao/CampanhasPanel';
import WorkflowsPanel from '@/components/automacao/WorkflowsPanel';
import ModelosPanel from '@/components/automacao/ModelosPanel';
import ExecucoesPanel from '@/components/automacao/ExecucoesPanel';

// Módulo central "Automação" (consolidação 11/08): Campanhas, Workflows,
// Modelos e Execuções viram abas internas (?tab=), não itens de sidebar. As
// rotas antigas (/campanhas, /workflows, /tarefas) redirecionam para cá.
// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function AutomacaoPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'campanhas' | 'workflows' | 'modelos' | 'execucoes';
const ABAS: Aba[] = ['campanhas', 'workflows', 'modelos', 'execucoes'];

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('campanhas');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
  }, [searchParams]);

  const TABS: { id: Aba; label: string; Icon: typeof Megaphone }[] = [
    { id: 'campanhas', label: 'Campanhas', Icon: Megaphone },
    { id: 'workflows', label: 'Workflows', Icon: Workflow },
    { id: 'modelos', label: 'Modelos', Icon: Layers },
    { id: 'execucoes', label: 'Execuções', Icon: Activity },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Bot size={22} className="text-indigo-400" /> Automação
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Campanhas, workflows, modelos reutilizáveis e execuções — um só lugar.
        </p>
      </div>

      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit animate-in stagger-2">
        {TABS.map((t) => (
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
        {aba === 'campanhas' && <CampanhasPanel />}
        {aba === 'workflows' && <WorkflowsPanel />}
        {aba === 'modelos' && <ModelosPanel />}
        {aba === 'execucoes' && <ExecucoesPanel />}
      </div>
    </div>
  );
}
