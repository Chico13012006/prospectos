'use client';

// Widgets de DADOS REAIS no topo do Dashboard (Fase 10). Agrega leads/tarefas/
// oportunidades/pipeline/campanhas/renovações por org (API /api/dashboard/resumo).
// Quais aparecem é configurável (workspaceConfig.dashboardWidgets). Fail-safe:
// em erro renderiza nada (nunca quebra o dashboard existente).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, ListTodo, Target, TrendingUp, Megaphone, RefreshCw } from 'lucide-react';

interface Resumo {
  leads: number; tarefasAbertas: number; oportAbertas: number;
  pipeline: number; campanhasAtivas: number; renovacoesJanela: number;
}

function brl(v: number): string {
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); } catch { return `R$ ${v}`; }
}

const DEF: Record<string, { label: string; icon: typeof Users; href: string; cor: string; fmt: (r: Resumo) => string }> = {
  leads: { label: 'Leads', icon: Users, href: '/base-leads', cor: 'text-indigo-400', fmt: (r) => String(r.leads) },
  tarefas: { label: 'Tarefas abertas', icon: ListTodo, href: '/automacao?tab=execucoes', cor: 'text-amber-400', fmt: (r) => String(r.tarefasAbertas) },
  oportunidades: { label: 'Oportunidades abertas', icon: Target, href: '/comercial?tab=oportunidades', cor: 'text-green-400', fmt: (r) => String(r.oportAbertas) },
  pipeline: { label: 'Pipeline em aberto', icon: TrendingUp, href: '/comercial?tab=oportunidades', cor: 'text-green-400', fmt: (r) => brl(r.pipeline) },
  campanhas: { label: 'Campanhas ativas', icon: Megaphone, href: '/automacao?tab=campanhas', cor: 'text-indigo-400', fmt: (r) => String(r.campanhasAtivas) },
  renovacoes: { label: 'Renovações na janela', icon: RefreshCw, href: '/automacao?tab=execucoes', cor: 'text-cyan-400', fmt: (r) => String(r.renovacoesJanela) },
};

export default function DashboardWidgets() {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [widgets, setWidgets] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/dashboard/resumo');
        if (!res.ok) return;
        const j = await res.json();
        setResumo(j.resumo ?? null);
        setWidgets(Array.isArray(j.widgets) ? j.widgets : []);
      } catch { /* fail-safe: sem widgets */ }
    })();
  }, []);

  if (!resumo || widgets.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {widgets.filter((w) => DEF[w]).map((w) => {
        const d = DEF[w];
        const Icon = d.icon;
        return (
          <Link key={w} href={d.href}
            className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-4 py-3 hover:border-indigo-500/50 transition-colors">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Icon size={13} className={d.cor} /> {d.label}</div>
            <div className={`text-lg font-bold mt-1 ${d.cor}`}>{d.fmt(resumo)}</div>
          </Link>
        );
      })}
    </div>
  );
}
