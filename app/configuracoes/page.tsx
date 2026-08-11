'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Sliders, SlidersHorizontal } from 'lucide-react';
import ParametrosMotorPanel from '@/components/configuracoes/ParametrosMotorPanel';
import ProcessoComercialPanel from '@/components/configuracoes/ProcessoComercialPanel';

// Configurações (consolidação 11/08): além dos parâmetros do motor, absorve o
// "Processo comercial" (que saiu da sidebar) como aba. Deep-link ?tab=processo
// (destino do redirect de /processo-comercial). useSearchParams exige Suspense.
export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'motor' | 'processo';
const ABAS: Aba[] = ['motor', 'processo'];

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('motor');

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
  }, [searchParams]);

  const TABS: { id: Aba; label: string; Icon: typeof Sliders }[] = [
    { id: 'motor', label: 'Motor de cadência', Icon: Sliders },
    { id: 'processo', label: 'Processo comercial', Icon: SlidersHorizontal },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Settings size={22} className="text-slate-300" />
          Configurações
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Parâmetros do motor e do processo comercial (nomenclaturas, pipelines, permissões).
        </p>
      </div>

      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit">
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

      {aba === 'motor' ? <ParametrosMotorPanel /> : <ProcessoComercialPanel />}
    </div>
  );
}
