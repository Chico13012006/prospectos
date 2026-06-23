'use client';

import { useApp } from '@/contexts/AppContext';
import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Users, MessageCircle, TrendingUp, ArrowRight, AlertTriangle,
  RefreshCw, Plus, Target, Calendar, Zap, Bot,
} from 'lucide-react';
import { getStatusBadgeClasses } from '@/lib/utils';
import { SdrPill } from '@/components/ui/SdrAvatar';
import { useState, useEffect } from 'react';
import { getLeadsStats, getLeadsRecentes, getLeadsPorResponsavel } from '@/lib/api';

const TODAY = '2026-06-16';

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

const funnelSteps = [
  { label: 'Encontrados', value: 1248, pct: '100%', color: '#4f46e5', w: 100 },
  { label: 'Qualificados', value: 684, pct: '54,8%', color: '#7c3aed', w: 88 },
  { label: 'Enviados', value: 522, pct: '41,8%', color: '#0891b2', w: 74 },
  { label: 'Responderam', value: 74, pct: '14,2%', color: '#059669', w: 56 },
  { label: 'Interesse identificado', value: 21, pct: '4,0%', color: '#d97706', w: 38 },
  { label: 'Encaminhados', value: 18, pct: '3,2%', color: '#16a34a', w: 26 },
];

const followUpBars = [
  { etapa: '1º contato', respostas: 28 },
  { etapa: '2º contato', respostas: 34 },
  { etapa: '3º contato', respostas: 12 },
];

const evolucaoDados = [
  { dia: '17/05', enviadas: 14, respostas: 2 },
  { dia: '18/05', enviadas: 18, respostas: 1 },
  { dia: '19/05', enviadas: 12, respostas: 3 },
  { dia: '20/05', enviadas: 20, respostas: 2 },
  { dia: '21/05', enviadas: 15, respostas: 1 },
  { dia: '22/05', enviadas: 22, respostas: 4 },
  { dia: '23/05', enviadas: 11, respostas: 2 },
  { dia: '24/05', enviadas: 16, respostas: 3 },
  { dia: '25/05', enviadas: 19, respostas: 2 },
  { dia: '26/05', enviadas: 23, respostas: 3 },
  { dia: '27/05', enviadas: 17, respostas: 1 },
  { dia: '28/05', enviadas: 25, respostas: 5 },
  { dia: '29/05', enviadas: 13, respostas: 2 },
  { dia: '30/05', enviadas: 21, respostas: 3 },
  { dia: '31/05', enviadas: 18, respostas: 2 },
  { dia: '01/06', enviadas: 24, respostas: 4 },
  { dia: '02/06', enviadas: 20, respostas: 3 },
  { dia: '03/06', enviadas: 26, respostas: 4 },
  { dia: '04/06', enviadas: 22, respostas: 2 },
  { dia: '05/06', enviadas: 28, respostas: 5 },
  { dia: '06/06', enviadas: 19, respostas: 3 },
  { dia: '07/06', enviadas: 30, respostas: 4 },
  { dia: '08/06', enviadas: 27, respostas: 5 },
  { dia: '09/06', enviadas: 25, respostas: 3 },
  { dia: '10/06', enviadas: 29, respostas: 4 },
  { dia: '11/06', enviadas: 23, respostas: 3 },
  { dia: '12/06', enviadas: 31, respostas: 5 },
  { dia: '13/06', enviadas: 28, respostas: 4 },
  { dia: '14/06', enviadas: 26, respostas: 3 },
  { dia: '15/06', enviadas: 24, respostas: 4 },
];

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const radius = 60;
  const cx = 80;
  const cy = 80;
  const strokeWidth = 20;

  let cumulative = 0;
  const segments = data.map((d) => {
    const pct = d.value / total;
    const start = cumulative;
    cumulative += pct;
    return { ...d, start, pct };
  });

  function polarToCartesian(pct: number) {
    const angle = pct * 2 * Math.PI - Math.PI / 2;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }

  function describeArc(start: number, end: number) {
    const s = polarToCartesian(start);
    const e = polarToCartesian(end);
    const large = end - start > 0.5 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`;
  }

  return (
    <div className="flex items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1e2435" strokeWidth={strokeWidth} />
        {segments.map((seg, i) => (
          <path
            key={i}
            d={describeArc(seg.start, seg.start + seg.pct)}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700" fill="#f1f5f9">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#64748b">leads</text>
      </svg>

      <div className="flex flex-col gap-2 flex-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-sm text-slate-300">{d.label}</span>
            <span className="text-sm font-medium text-slate-100 ml-auto pl-4">{d.value}</span>
            <span className="text-xs text-slate-500 w-10 text-right">
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const NICHO_DONUT_CORES: Record<string, string> = {
  'Logística': '#6366f1',
  'Mineração': '#7c3aed',
  'Agro': '#10b981',
  'Indústria': '#f59e0b',
};

export default function DashboardPage() {
  const { empresas, abordagens, respostas, followUps } = useApp();

  const [leadsData, setLeadsData] = useState<any[]>([])
  const [leadsRecentes, setLeadsRecentes] = useState<any[]>([])
  const [sdrDataSupabase, setSdrDataSupabase] = useState<any[]>([])

  useEffect(() => {
    async function carregarDash() {
      try {
        const [stats, recentes, sdrs] = await Promise.all([
          getLeadsStats(),
          getLeadsRecentes(10),
          getLeadsPorResponsavel(),
        ])
        if (stats) setLeadsData(stats)
        if (recentes.length > 0) setLeadsRecentes(recentes)
        if (sdrs.length > 0) setSdrDataSupabase(sdrs)
      } catch (err) {
        console.error('Erro ao carregar dashboard:', err)
      }
    }
    carregarDash()
  }, [])

  const leadsEncontrados = leadsData.length > 0 ? leadsData.length : empresas.length;
  const leadsQualificados = leadsData.length > 0
    ? leadsData.filter((l: any) => l.estagio !== 'novos_leads').length
    : empresas.filter(e => e.status !== 'novo' && !e.blacklist && e.status !== 'descartado').length;
  const mensagensEnviadas = abordagens.length;
  const respostasRecebidas = respostas.length;
  const leadsEncaminhados = leadsData.length > 0
    ? leadsData.filter((l: any) => l.estagio === 'reuniao_agendada').length
    : empresas.filter(e => e.estagio_pipeline === 'reuniao_agendada' || e.status === 'respondeu_positivo').length;

  const nichoData = [
    { nicho: 'Logística', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Mineração', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Agro', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Indústria', positivos: 1, responsavel: 'Silmara' },
  ];

  const leadsInteresseMock = empresas.filter(
    e => e.status === 'respondeu_positivo' || e.status === 'pediu_mais_info'
  ).slice(0, 5);

  const sdrDataMock = ['Francisco', 'Silmara'].map(sdr => {
    const leads = empresas.filter(e => e.responsavel === sdr);
    const msgs = abordagens.filter(a => {
      const emp = empresas.find(e => e.id === a.empresa_id);
      return emp?.responsavel === sdr;
    }).length;
    const resps = respostas.filter(r => {
      const emp = empresas.find(e => e.id === r.empresa_id);
      return emp?.responsavel === sdr;
    }).length;
    const reunioes = leads.filter(e => e.estagio_pipeline === 'reuniao_agendada').length;
    const taxa = msgs > 0 ? Math.round((resps / msgs) * 100) : 0;
    return { sdr, leads: leads.length, msgs, resps, taxa, reunioes };
  });

  const atrasados = followUps.filter(f => f.status === 'atrasado').length;

  function calcularFunil(data: any[]) {
    const total = data.length || 1
    const novos = data.filter((l: any) => l.estagio === 'novos_leads').length
    const enviados = data.filter((l: any) => l.estagio !== 'novos_leads').length
    const responderam = data.filter((l: any) => ['aguardando_resposta', 'follow_up', 'interessado', 'reuniao_agendada'].includes(l.estagio)).length
    const interesse = data.filter((l: any) => l.estagio === 'interessado' || l.estagio === 'reuniao_agendada').length
    const encaminhados = data.filter((l: any) => l.estagio === 'reuniao_agendada').length
    return [
      { label: 'Encontrados', value: total, pct: '100%', color: '#4f46e5', w: 100 },
      { label: 'Qualificados', value: total - novos, pct: `${Math.round((total - novos) / total * 100)}%`, color: '#7c3aed', w: Math.max(Math.round((total - novos) / total * 100), 10) },
      { label: 'Enviados', value: enviados, pct: `${Math.round(enviados / total * 100)}%`, color: '#0891b2', w: Math.max(Math.round(enviados / total * 100), 10) },
      { label: 'Responderam', value: responderam, pct: `${Math.round(responderam / total * 100)}%`, color: '#059669', w: Math.max(Math.round(responderam / total * 100), 5) },
      { label: 'Interesse identificado', value: interesse, pct: `${Math.round(interesse / total * 100)}%`, color: '#d97706', w: Math.max(Math.round(interesse / total * 100), 5) },
      { label: 'Encaminhados', value: encaminhados, pct: `${Math.round(encaminhados / total * 100)}%`, color: '#16a34a', w: Math.max(Math.round(encaminhados / total * 100), 5) },
    ]
  }

  const activeFunnelSteps = leadsData.length > 0 ? calcularFunil(leadsData) : funnelSteps

  const activeFila = leadsRecentes.length > 0
    ? leadsRecentes.slice(0, 5).map((l: any) => ({
        id: l.id,
        nome: l.empresa,
        segmento: l.segmento,
        responsavel: l.responsavel_id ?? '',
        estagio: l.estagio,
        badge: l.estagio === 'reuniao_agendada' ? 'Encaminhado' : l.estagio === 'novos_leads' ? 'Novo' : 'Pendente',
      }))
    : leadsInteresseMock.map(e => ({
        id: e.id,
        nome: e.nome,
        segmento: e.segmento,
        responsavel: e.responsavel,
        estagio: e.estagio_pipeline,
        badge: e.estagio_pipeline === 'reuniao_agendada' ? 'Encaminhado' : e.status === 'pediu_mais_info' ? 'Novo' : 'Pendente',
      }))

  const activeSdrData = sdrDataSupabase.length > 0
    ? sdrDataSupabase.map((s: any) => ({ sdr: s.nome, leads: s.total, msgs: 0, resps: 0, taxa: 0, reunioes: s.reunioes }))
    : sdrDataMock

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Monitore a prospecção, follow-ups e distribuição de leads em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-[#1a1f2e] border border-[#2a3147] rounded-lg px-3 py-2">
            <RefreshCw size={12} />
            Dados atualizados há 5 min
          </div>
          <button
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-none"
          >
            <Plus size={15} /> Nova automação
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {['Últimos 30 dias', 'Todos os nichos', 'Todos os status'].map((label, i) => (
          <select
            key={i}
            className="text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none"
          >
            <option>{label}</option>
          </select>
        ))}
        <button className="text-sm text-slate-400 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] hover:bg-[#0f1117]">
          Atualizar
        </button>
      </div>

      {/* 5 KPI Cards com sparkline */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
        {[
          { label: 'Leads Encontrados', value: leadsEncontrados, pct: '+12%', icon: Users, color: '#6366f1', iconColor: 'text-indigo-400', iconBg: 'bg-indigo-500/20' },
          { label: 'Leads Qualificados', value: leadsQualificados, pct: '+8%', icon: Target, color: '#7c3aed', iconColor: 'text-violet-400', iconBg: 'bg-violet-500/20' },
          { label: 'Mensagens Enviadas', value: mensagensEnviadas, pct: '+23%', icon: MessageCircle, color: '#06b6d4', iconColor: 'text-cyan-400', iconBg: 'bg-cyan-500/20' },
          { label: 'Respostas Recebidas', value: respostasRecebidas, pct: '+5%', icon: TrendingUp, color: '#10b981', iconColor: 'text-emerald-400', iconBg: 'bg-emerald-500/20' },
          { label: 'Leads Encaminhados', value: leadsEncaminhados, pct: '+40%', icon: Calendar, color: '#f59e0b', iconColor: 'text-amber-400', iconBg: 'bg-amber-500/20' },
        ].map((kpi, idx) => {
          const gid = `spark-${idx}`;
          return (
            <div key={kpi.label} className="card card-hover p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                    <kpi.icon size={16} className={kpi.iconColor} />
                  </div>
                  <span className="text-sm text-slate-400">{kpi.label}</span>
                </div>
                <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                  {kpi.pct}
                </span>
              </div>
              <div className="text-3xl font-bold text-slate-100">{kpi.value}</div>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="w-full h-6">
                <defs>
                  <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={kpi.color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={kpi.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polyline
                  points="0,20 16,16 33,18 50,10 66,14 83,6 100,8 100,24 0,24"
                  fill={`url(#${gid})`}
                  stroke="none"
                />
                <polyline
                  points="0,20 16,16 33,18 50,10 66,14 83,6 100,8"
                  fill="none"
                  stroke={kpi.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          );
        })}
      </div>

      {/* Funil + Eficiência Follow-up */}
      <div className="grid grid-cols-5 gap-5">
        {/* Funil da IA */}
        <div className="col-span-3 bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Zap size={16} className="text-indigo-500" />
            Funil da IA
          </h2>
          <div className="flex items-center gap-3 pb-1 mb-1">
            <span className="flex-1 text-xs text-slate-500 font-medium uppercase tracking-wide">Etapa</span>
            <span className="w-16 text-right text-xs text-slate-500 font-medium uppercase tracking-wide">Qtd</span>
            <span className="w-16 text-right text-xs text-slate-500 font-medium uppercase tracking-wide">Conversão</span>
          </div>
          <div>
            {activeFunnelSteps.map(step => (
              <div key={step.label} className="flex items-center gap-3 py-2 border-b border-[#2a3147] last:border-0">
                <div
                  className="w-12 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ backgroundColor: step.color }}
                >
                  {step.value}
                </div>
                <span className="flex-1 text-sm text-slate-300">{step.label}</span>
                <span className="w-16 text-right text-sm font-medium text-slate-100">
                  {step.value.toLocaleString('pt-BR')}
                </span>
                <span className="w-16 text-right text-sm text-slate-400">{step.pct}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Eficiência de Follow-up */}
        <div className="col-span-2 bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Calendar size={16} className="text-green-500" />
            Eficiência de Follow-up
          </h2>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: 'Taxa resp. 1º contato', value: '8,4%', delta: '↑ 1,3 p.p.' },
              { label: 'Taxa resp. 2º follow-up', value: '13,7%', delta: '↑ 2,1 p.p.' },
              { label: 'Taxa resp. 3º follow-up', value: '9,2%', delta: '↑ 0,8 p.p.' },
              { label: 'Respostas por follow-up', value: '34', delta: '↑ 19,3%' },
            ].map(item => (
              <div key={item.label} className="bg-[#0f1117] rounded-lg p-2.5">
                <div className="text-xs text-slate-400 leading-tight mb-1">{item.label}</div>
                <div className="text-lg font-bold text-slate-200">{item.value}</div>
                <div className="text-xs text-green-400 font-medium">{item.delta}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={followUpBars} margin={{ left: -25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
              <XAxis dataKey="etapa" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 11 }} />
              <Bar dataKey="respostas" fill="#22c55e" name="Respostas" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Nicho + Leads interesse + Alertas */}
      <div className="grid grid-cols-3 gap-5">
        {/* Distribuição por nicho */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Target size={16} className="text-indigo-500" />
            Distribuição por nicho
          </h2>
          <DonutChart
            data={nichoData.map(n => ({
              label: n.nicho,
              value: n.positivos,
              color: NICHO_DONUT_CORES[n.nicho] || '#94a3b8',
            }))}
          />
          <Link href="/pipeline" className="mt-4 text-xs text-indigo-400 hover:underline flex items-center gap-1">
            Ver todos os nichos <ArrowRight size={11} />
          </Link>
        </div>

        {/* Fila de leads com interesse */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <Users size={16} className="text-green-500" />
            Fila de leads com interesse
          </h2>
          <div className="space-y-2">
            {activeFila.map(item => (
              <Link key={item.id} href={`/leads/${item.id}`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border border-[#2a3147] hover:bg-[#0f1117] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{item.nome}</div>
                    <div className="text-xs text-slate-400">{item.segmento}</div>
                  </div>
                  <div className="shrink-0"><SdrPill name={item.responsavel} /></div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
                    item.badge === 'Encaminhado'
                      ? 'bg-green-500/20 text-green-400'
                      : item.badge === 'Novo'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {item.badge}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/pipeline" className="mt-3 text-xs text-indigo-400 hover:underline flex items-center gap-1">
            Ver todos os leads <ArrowRight size={11} />
          </Link>
        </div>

        {/* Alertas da automação */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            Alertas da automação
          </h2>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <span className="shrink-0">⚠️</span>
              <p className="text-sm text-red-400">
                {atrasados} automações com baixa taxa de resposta
              </p>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="shrink-0">🟡</span>
              <p className="text-sm text-amber-400">
                12 leads com interesse identificado aguardando ação
              </p>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <span className="shrink-0">🔵</span>
              <p className="text-sm text-blue-400">1 nicho sem responsável definido</p>
            </div>
          </div>
          <Link href="/configuracoes" className="mt-3 text-xs text-indigo-400 hover:underline flex items-center gap-1">
            Ver todos os alertas <ArrowRight size={11} />
          </Link>
        </div>
      </div>

      {/* Evolução de prospecções */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500" />
          Evolução de prospecções — últimos 30 dias
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={evolucaoDados} margin={{ left: -10 }}>
            <defs>
              <linearGradient id="gradEnviadas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRespostas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
            <XAxis dataKey="dia" tick={{ fontSize: 10 }} interval={4} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }} />
            <Legend iconType="circle" iconSize={8}
              formatter={v => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
            <Area type="monotone" dataKey="enviadas" stroke="#6366f1" strokeWidth={2}
              fill="url(#gradEnviadas)" name="Mensagens enviadas" dot={false} />
            <Area type="monotone" dataKey="respostas" stroke="#22c55e" strokeWidth={2}
              fill="url(#gradRespostas)" name="Respostas recebidas" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Desempenho por SDR */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Users size={16} className="text-indigo-500" />
          Desempenho por SDR
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              {['SDR', 'Leads captados', 'Mensagens enviadas', 'Taxa de resposta', 'Reuniões agendadas'].map(h => (
                <th key={h} className={`py-2 px-3 text-xs text-slate-400 font-medium ${h === 'SDR' ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeSdrData.map(sdr => (
              <tr key={sdr.sdr} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-3 px-3">
                  <SdrPill name={sdr.sdr} />
                </td>
                <td className="py-3 px-3 text-right font-semibold text-slate-300">{sdr.leads}</td>
                <td className="py-3 px-3 text-right text-slate-300">{sdr.msgs}</td>
                <td className="py-3 px-3 text-right font-semibold text-green-400">{sdr.taxa}%</td>
                <td className="py-3 px-3 text-right font-semibold text-slate-300">{sdr.reunioes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Meta do mês */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-200 flex items-center gap-2">
            <Target size={16} className="text-indigo-500" />
            Meta do mês
          </h2>
          <span className="text-sm font-bold text-indigo-400">78%</span>
        </div>
        <div className="flex items-center justify-between text-sm text-slate-400 mb-2">
          <span>Reuniões agendadas: <span className="font-bold text-slate-200">39</span></span>
          <span>Meta: <span className="font-bold text-slate-200">50</span></span>
        </div>
        <div className="w-full bg-[#252b3b] rounded-full h-3">
          <div className="h-3 rounded-full bg-indigo-500 transition-all" style={{ width: '78%' }} />
        </div>
        <p className="text-xs text-slate-500 mt-2">78% da meta atingida — faltam 11 reuniões para bater o objetivo mensal.</p>
      </div>

      {/* IA card */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
            <Bot size={20} className="text-green-400" />
          </div>
          <div>
            <div className="font-semibold text-slate-200">IA trabalhando 24/7</div>
            <p className="text-sm text-slate-400">Prospectando, qualificando e gerando oportunidades para seu time.</p>
          </div>
        </div>
        <Link
          href="/configuracoes"
          className="flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-4 py-2 rounded-lg hover:bg-indigo-500/10 transition-colors"
        >
          Ver automações <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
