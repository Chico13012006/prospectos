'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { BrainCircuit, FileText, Database, Trophy } from 'lucide-react';
import EmptyState from '@/components/charts/EmptyState';
import TemplatesPanel from '@/components/templates/TemplatesPanel';
import AnimatedKpiCard from '@/components/charts/AnimatedKpiCard';
import { getInteligenciaComercialResumo } from '@/lib/api';

// useSearchParams() exige limite de Suspense (Next) — conteúdo real em Inner.
export default function InteligenciaComercialPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

type Aba = 'analises' | 'templates';

function Inner() {
  const searchParams = useSearchParams();
  const [aba, setAba] = useState<Aba>('analises');

  // Deep-link: ?tab=templates abre a aba de Templates (ex.: redirect de /templates).
  useEffect(() => {
    if (searchParams.get('tab') === 'templates') setAba('templates');
  }, [searchParams]);

  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100">Inteligência Comercial</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Análises detalhadas e biblioteca de templates da sua prospecção.
        </p>
      </div>

      {/* Abas: Análises · Templates */}
      <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-0.5 w-fit animate-in stagger-2">
        {([
          { id: 'analises', label: 'Análises', Icon: BrainCircuit },
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
        {aba === 'analises' ? (
          <Analises />
        ) : (
          <TemplatesPanel />
        )}
      </div>
    </div>
  );
}

// Dois KPIs reais (base + conversões), escopados à organização via RLS. Enquanto
// as análises completas (canal/segmento/horário) não existem, esta aba mostra os
// números que batem com a Base de Leads/Pipeline. Falha de query ou base vazia
// cai de volta pro EmptyState — nunca zero fixo nem tela quebrada.
function Analises() {
  const [resumo, setResumo] = useState<{ totalLeads: number; conversoes: number } | null>(null);
  const [erro, setErro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInteligenciaComercialResumo()
      .then(setResumo)
      .catch(err => { console.error('Erro ao carregar Inteligência Comercial:', err); setErro(true); })
      .finally(() => setLoading(false));
  }, []);

  // Erro de conexão, ou base sem nenhum lead → estado vazio (não inventar zero).
  if (erro || (!loading && (!resumo || resumo.totalLeads === 0))) {
    return (
      <div className="card p-5">
        <EmptyState
          icon={BrainCircuit}
          title="Esta análise ainda não está conectada a dados reais"
          description="As análises de canais, segmentos, horários e templates serão construídas a partir dos envios e respostas do motor. Por enquanto, acompanhe a operação pelo Dashboard e pelo Pipeline."
          className="py-16"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
      <AnimatedKpiCard
        label="Total de leads na base"
        value={resumo?.totalLeads ?? 0}
        icon={Database}
        color="#6366f1"
        iconColor="text-indigo-400"
        iconBg="bg-indigo-500/20"
        loading={loading}
      />
      <AnimatedKpiCard
        label="Conversões"
        value={resumo?.conversoes ?? 0}
        icon={Trophy}
        color="#10b981"
        iconColor="text-emerald-400"
        iconBg="bg-emerald-500/20"
        loading={loading}
      />
    </div>
  );
}
