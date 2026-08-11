'use client';

import { useState, useEffect } from 'react';
import { Trophy, TrendingUp, XCircle, Percent, Coins } from 'lucide-react';

// Painel de ROI — ROI deixou de ser módulo isolado. Vive como visão de analytics
// dentro de Inteligência Comercial (aba ROI). Deriva das oportunidades
// (/api/roi, lib/roi) — sem valor inventado: sem dado, mostra "—".

interface Resumo {
  ganho: number; pipeline: number; perdido: number;
  ganhas: number; perdidas: number; abertas: number;
  taxaConversao: number; ticketMedio: number;
  custoMensal: number | null; roiPercent: number | null;
}

function brl(v: number): string {
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${v}`; }
}
function pct(v: number): string { return `${(v * 100).toFixed(0)}%`; }

export default function RoiPanel() {
  const [r, setR] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [negado, setNegado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/roi');
        if (res.status === 403) { setNegado(true); return; }
        const j = res.ok ? await res.json() : null;
        setR(j?.resumo ?? null);
      } finally { setCarregando(false); }
    })();
  }, []);

  const Card = ({ icon: Icon, cor, label, valor, sub }: { icon: typeof Trophy; cor: string; label: string; valor: string; sub?: string }) => (
    <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4">
      <div className="flex items-center gap-2 text-xs text-slate-500"><Icon size={15} className={cor} /> {label}</div>
      <div className={`text-xl font-bold mt-1 ${cor}`}>{valor}</div>
      {sub && <div className="text-xs text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );

  if (negado) {
    return (
      <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-10 text-center text-slate-400 text-sm">
        Sem permissão para ver analytics (requer <code className="text-indigo-300">analytics.view</code>).
      </div>
    );
  }
  if (carregando) return <div className="p-10 text-center text-slate-500 text-sm">Carregando…</div>;
  if (!r) return <div className="p-10 text-center text-slate-500 text-sm">Sem dados suficientes — ROI não calculável.</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={Trophy} cor="text-green-400" label="Ganho" valor={brl(r.ganho)} sub={`${r.ganhas} negócio(s)`} />
        <Card icon={TrendingUp} cor="text-indigo-400" label="Pipeline em aberto" valor={brl(r.pipeline)} sub={`${r.abertas} aberta(s)`} />
        <Card icon={XCircle} cor="text-red-400" label="Perdido" valor={brl(r.perdido)} sub={`${r.perdidas} perdida(s)`} />
        <Card icon={Percent} cor="text-slate-200" label="Conversão" valor={pct(r.taxaConversao)} sub="ganhas / fechadas" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card icon={Coins} cor="text-slate-200" label="Ticket médio (ganho)" valor={brl(r.ticketMedio)} />
        <Card icon={Coins} cor="text-slate-200" label="Custo mensal (config)" valor={r.custoMensal != null ? brl(r.custoMensal) : '—'} sub={r.custoMensal == null ? 'Defina em Configurações' : undefined} />
        <Card icon={Percent} cor={r.roiPercent != null && r.roiPercent >= 0 ? 'text-green-400' : 'text-red-400'} label="ROI sobre o custo" valor={r.roiPercent != null ? pct(r.roiPercent) : '—'} sub={r.roiPercent == null ? 'Requer custo mensal' : undefined} />
      </div>
    </div>
  );
}
