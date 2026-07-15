'use client';

import { BrainCircuit } from 'lucide-react';
import EmptyState from '@/components/charts/EmptyState';

// Tela ainda NÃO conectada a dado real: os gráficos/KPIs antigos eram mock
// (números inventados) e foram removidos. Quando as análises reais forem
// implementadas, esta página volta a ganhar conteúdo.
export default function InteligenciaComercialPage() {
  return (
    <div className="p-6 space-y-5">
      <div className="animate-in stagger-1">
        <h1 className="text-2xl font-bold text-slate-100">Inteligência Comercial</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Análises detalhadas para otimizar sua prospecção e automações.
        </p>
      </div>

      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-5 animate-in stagger-2">
        <EmptyState
          icon={BrainCircuit}
          title="Esta tela ainda não está conectada a dados reais"
          description="As análises de canais, segmentos, horários e templates serão construídas a partir dos envios e respostas do motor. Por enquanto, acompanhe a operação pelo Dashboard e pelo Pipeline."
          className="py-16"
        />
      </div>
    </div>
  );
}
