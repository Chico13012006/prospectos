'use client';

// Widgets de DADOS REAIS no topo do Dashboard (Fase 10). Agrega leads/tarefas/
// oportunidades/pipeline/campanhas/renovações por org (API /api/dashboard/resumo).
// Quais aparecem é configurável (workspaceConfig.dashboardWidgets). Fail-safe:
// em erro renderiza nada (nunca quebra o dashboard existente).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Users, ListTodo, Target, TrendingUp, Megaphone, RefreshCw } from 'lucide-react';

interface Resumo {
  leads: number; tarefasAbertas: number; oportAbertas: number;
  pipeline: number; campanhasAtivas: number; renovacoesJanela: number;
  validade: {
    vencidos: number; proximos30: number; entre31e60: number; proximos60: number;
    totalComData: number; servicos: number; legados: number;
  };
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
  const widgetsVisiveis = widgets.filter((w) => DEF[w]);
  const widgetsOrdenados = [
    ...widgetsVisiveis.filter((w) => w === 'renovacoes'),
    ...widgetsVisiveis.filter((w) => w !== 'renovacoes'),
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {widgetsOrdenados.map((w) => {
        const d = DEF[w];
        if (w === 'renovacoes') {
          return (
            <Link key={w} href={d.href}
              className="col-span-2 md:col-span-3 lg:col-span-5 bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-4 py-3 hover:border-cyan-500/50 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <RefreshCw size={13} className="text-cyan-400" /> Controle de validades
                </div>
                <span className="text-[10px] text-slate-500">
                  {resumo.validade.servicos} serviços recorrentes · {resumo.validade.legados} da Base de Leads
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500"><AlertTriangle size={11} className="text-rose-400" /> Vencidos</div>
                  <div className="text-lg font-bold text-rose-400">{resumo.validade.vencidos}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500"><CalendarClock size={11} className="text-amber-400" /> Próx. 30 dias</div>
                  <div className="text-lg font-bold text-amber-400">{resumo.validade.proximos30}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500"><CalendarClock size={11} className="text-cyan-400" /> Próx. 60 dias</div>
                  <div className="text-lg font-bold text-cyan-400">{resumo.validade.proximos60}</div>
                </div>
              </div>
            </Link>
          );
        }
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
