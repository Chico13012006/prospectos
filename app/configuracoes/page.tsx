'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Sliders, SlidersHorizontal, Palette, Target } from 'lucide-react';
import ParametrosMotorPanel from '@/components/configuracoes/ParametrosMotorPanel';
import ProcessoComercialPanel from '@/components/configuracoes/ProcessoComercialPanel';
import PersonalizacaoPanel from '@/components/configuracoes/PersonalizacaoPanel';
import ObjetivosOperacaoPanel from '@/components/configuracoes/ObjetivosOperacaoPanel';

// Configurações por workspace: objetivos, motor, processo e personalização.
// Deep-links por ?tab. useSearchParams exige Suspense.
export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'objetivos' | 'motor' | 'processo' | 'personalizacao';
const ABAS: Aba[] = ['objetivos', 'motor', 'processo', 'personalizacao'];

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('objetivos');
  // Esconder o item na sidebar não basta: a URL é acessível direto. `null`
  // enquanto carrega, para não piscar "sem permissão" para quem tem.
  const [podeConfigurar, setPodeConfigurar] = useState<boolean | null>(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && (ABAS as string[]).includes(tab)) setAba(tab as Aba);
  }, [searchParams]);

  useEffect(() => {
    let ativo = true;
    fetch('/api/rbac/permissoes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo) return;
        const minhas: string[] = Array.isArray(d?.minhas) ? d.minhas : [];
        setPodeConfigurar(minhas.includes('workspace.configure'));
      })
      .catch(() => { if (ativo) setPodeConfigurar(false); });
    return () => { ativo = false; };
  }, []);

  if (podeConfigurar === null) {
    return <div className="p-6 text-sm text-slate-500">Carregando…</div>;
  }
  if (!podeConfigurar) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-10 text-center">
          <Settings size={22} className="mx-auto text-slate-500" />
          <h1 className="mt-3 text-lg font-semibold text-slate-200">Configurações do workspace</h1>
          <p className="mt-1 text-sm text-slate-400">
            Estas configurações valem para toda a operação — motor de cadência, processo comercial e
            personalização. O seu acesso não inclui alterá-las.
          </p>
          <p className="mt-3 text-xs text-slate-600">
            Requer a permissão <code className="text-indigo-300">workspace.configure</code>.
          </p>
        </div>
      </div>
    );
  }

  const TABS: { id: Aba; label: string; Icon: typeof Sliders }[] = [
    { id: 'objetivos', label: 'Objetivos da operação', Icon: Target },
    { id: 'motor', label: 'Motor de cadência', Icon: Sliders },
    { id: 'processo', label: 'Processo comercial', Icon: SlidersHorizontal },
    { id: 'personalizacao', label: 'Personalização', Icon: Palette },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Settings size={22} className="text-slate-300" />
          Configurações
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Objetivos, motor, processo comercial e personalização do workspace.
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

      {aba === 'objetivos' && <ObjetivosOperacaoPanel />}
      {aba === 'motor' && <ParametrosMotorPanel />}
      {aba === 'processo' && <ProcessoComercialPanel />}
      {aba === 'personalizacao' && <PersonalizacaoPanel />}
    </div>
  );
}
