'use client';

import Link from 'next/link';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Sector, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Users, TrendingUp, ArrowRight,
  RefreshCw, Plus, Target, Calendar, Zap, Bot,
} from 'lucide-react';
import { getStatusBadgeClasses } from '@/lib/utils';
import { SdrPill } from '@/components/ui/SdrAvatar';
import { useState, useEffect } from 'react';
import { getLeadsStats, getLeadsRecentes, getLeadsPorResponsavel } from '@/lib/api';
import AnimatedKpiCard from '@/components/charts/AnimatedKpiCard';
import ChartContainer from '@/components/charts/ChartContainer';
import ChartTooltip from '@/components/charts/ChartTooltip';

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

// Sector expandido no hover (destaque visual do setor analisado no donut).
function renderActiveDonutShape(props: any) {
  const { outerRadius, ...rest } = props;
  return <Sector {...rest} outerRadius={(outerRadius ?? 64) + 6} />;
}

function NichoDonut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex items-center gap-6">
      <div className="w-40 h-40 relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={64}
              paddingAngle={2}
              stroke="none"
              isAnimationActive
              animationDuration={700}
              animationEasing="ease-out"
              activeShape={renderActiveDonutShape}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              content={
                <ChartTooltip
                  formatter={(item) => `${item.value} lead${Number(item.value) === 1 ? '' : 's'}`}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-slate-100">{total}</span>
          <span className="text-[11px] text-slate-500">leads</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-sm text-slate-300">{d.label}</span>
            <span className="text-sm font-medium text-slate-100 ml-auto pl-4">{d.value}</span>
            <span className="text-xs text-slate-500 w-10 text-right">
              {total ? Math.round((d.value / total) * 100) : 0}%
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
  const [leadsData, setLeadsData] = useState<any[]>([])
  const [leadsRecentes, setLeadsRecentes] = useState<any[]>([])
  const [sdrDataSupabase, setSdrDataSupabase] = useState<any[]>([])
  const [loadingDash, setLoadingDash] = useState(true)

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
      } finally {
        setLoadingDash(false)
      }
    }
    carregarDash()
  }, [])

  const leadsEncontrados = leadsData.length;
  const leadsQualificados = leadsData.filter((l: any) => l.estagio !== 'novos_leads').length;
  const leadsEncaminhados = leadsData.filter((l: any) => l.estagio === 'reuniao_agendada').length;

  const nichoData = [
    { nicho: 'Logística', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Mineração', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Agro', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Indústria', positivos: 1, responsavel: 'Silmara' },
  ];

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

  const activeFunnelSteps = calcularFunil(leadsData)

  const activeFila = leadsRecentes.slice(0, 5).map((l: any) => ({
    id: l.id,
    nome: l.empresa,
    segmento: l.segmento,
    // Nome do responsável, nunca o UUID: usuario via FK quando existir,
    // senão o nome legado do CSV (responsavel_id é null em 100% dos leads).
    responsavel: l.usuarios?.nome ?? l.responsavel_nome ?? '',
    estagio: l.estagio,
    badge: l.estagio === 'reuniao_agendada' ? 'Encaminhado' : l.estagio === 'novos_leads' ? 'Novo' : 'Pendente',
  }))

  const activeSdrData = sdrDataSupabase.map((s: any) => ({ sdr: s.nome, leads: s.total, msgs: 0, resps: 0, taxa: 0, reunioes: s.reunioes }))

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between animate-in stagger-1">
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
      <div className="flex items-center gap-2 flex-wrap animate-in stagger-2">
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

      {/* 3 KPI Cards com sparkline animada (contagem + entrada) */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {[
          { label: 'Leads Encontrados', value: leadsEncontrados, pct: '+12%', icon: Users, color: '#6366f1', iconColor: 'text-indigo-400', iconBg: 'bg-indigo-500/20' },
          { label: 'Leads Qualificados', value: leadsQualificados, pct: '+8%', icon: Target, color: '#7c3aed', iconColor: 'text-violet-400', iconBg: 'bg-violet-500/20' },
          { label: 'Leads Encaminhados', value: leadsEncaminhados, pct: '+40%', icon: Calendar, color: '#f59e0b', iconColor: 'text-amber-400', iconBg: 'bg-amber-500/20' },
        ].map((kpi) => (
          <AnimatedKpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.pct}
            icon={kpi.icon}
            color={kpi.color}
            iconColor={kpi.iconColor}
            iconBg={kpi.iconBg}
            loading={loadingDash}
          />
        ))}
      </div>

      {/* Funil + Eficiência Follow-up */}
      <div className="grid grid-cols-5 gap-5">
        {/* Funil da IA */}
        <ChartContainer
          title="Funil da IA"
          icon={Zap}
          iconColor="text-indigo-500"
          loading={loadingDash}
          skeletonVariant="table"
          skeletonRows={6}
          className="col-span-3"
        >
          <div className="flex items-center gap-3 pb-1 mb-1">
            <span className="flex-1 text-xs text-slate-500 font-medium uppercase tracking-wide">Etapa</span>
            <span className="w-16 text-right text-xs text-slate-500 font-medium uppercase tracking-wide">Qtd</span>
            <span className="w-16 text-right text-xs text-slate-500 font-medium uppercase tracking-wide">Conversão</span>
          </div>
          <div>
            {activeFunnelSteps.map(step => (
              <div key={step.label} className="flex items-center gap-3 py-2 border-b border-[#2a3147] last:border-0 hover:bg-[#0f1117] rounded-md transition-colors">
                <div
                  className="w-12 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white shrink-0 hover-pop"
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
        </ChartContainer>

        {/* Eficiência de Follow-up */}
        <ChartContainer
          title="Eficiência de Follow-up"
          icon={Calendar}
          iconColor="text-green-500"
          loading={loadingDash}
          skeletonVariant="bars"
          skeletonRows={4}
          className="col-span-2"
        >
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: 'Taxa resp. 1º contato', value: '8,4%', delta: '↑ 1,3 p.p.' },
              { label: 'Taxa resp. 2º follow-up', value: '13,7%', delta: '↑ 2,1 p.p.' },
              { label: 'Taxa resp. 3º follow-up', value: '9,2%', delta: '↑ 0,8 p.p.' },
              { label: 'Respostas por follow-up', value: '34', delta: '↑ 19,3%' },
            ].map(item => (
              <div key={item.label} className="bg-[#0f1117] rounded-lg p-2.5 hover-pop">
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
              <Tooltip
                cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }}
                content={<ChartTooltip formatter={(item) => `${item.value} resposta${Number(item.value) === 1 ? '' : 's'}`} />}
              />
              <Bar
                dataKey="respostas"
                fill="#22c55e"
                name="Respostas"
                radius={[3, 3, 0, 0]}
                isAnimationActive
                animationDuration={800}
                animationEasing="ease-out"
                activeBar={{ fillOpacity: 0.85, stroke: '#0f1117', strokeWidth: 1 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Nicho + Leads interesse */}
      <div className="grid grid-cols-2 gap-5">
        {/* Distribuição por nicho */}
        <ChartContainer
          title="Distribuição por nicho"
          icon={Target}
          iconColor="text-indigo-500"
          loading={loadingDash}
          skeletonVariant="donut"
        >
          <NichoDonut
            data={nichoData.map(n => ({
              label: n.nicho,
              value: n.positivos,
              color: NICHO_DONUT_CORES[n.nicho] || '#94a3b8',
            }))}
          />
          <Link href="/pipeline" className="mt-4 text-xs text-indigo-400 hover:underline flex items-center gap-1">
            Ver todos os nichos <ArrowRight size={11} />
          </Link>
        </ChartContainer>

        {/* Fila de leads com interesse */}
        <ChartContainer
          title="Fila de leads com interesse"
          icon={Users}
          iconColor="text-green-500"
          loading={loadingDash}
          empty={activeFila.length === 0}
          emptyTitle="Nenhum lead com interesse no momento"
          emptyDescription="Assim que alguém responder ou pedir mais informações, aparece aqui."
          skeletonVariant="table"
          skeletonRows={5}
        >
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
        </ChartContainer>

      </div>

      {/* Evolução de prospecções */}
      <ChartContainer
        title="Evolução de prospecções — últimos 30 dias"
        icon={TrendingUp}
        iconColor="text-indigo-500"
        loading={loadingDash}
        skeletonHeight={200}
      >
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
            <Tooltip
              cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeOpacity: 0.35 }}
              content={<ChartTooltip formatter={(item) => `${item.value} ${item.name === 'Respostas recebidas' ? 'resposta(s)' : 'mensagem(ns)'}`} />}
            />
            <Legend iconType="circle" iconSize={8}
              formatter={v => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
            <Area
              type="monotone" dataKey="enviadas" stroke="#6366f1" strokeWidth={2}
              fill="url(#gradEnviadas)" name="Mensagens enviadas" dot={false}
              isAnimationActive animationDuration={900} animationEasing="ease-out"
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#0f1117' }}
            />
            <Area
              type="monotone" dataKey="respostas" stroke="#22c55e" strokeWidth={2}
              fill="url(#gradRespostas)" name="Respostas recebidas" dot={false}
              isAnimationActive animationDuration={900} animationEasing="ease-out"
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#0f1117' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>

      {/* Desempenho por SDR */}
      <ChartContainer
        title="Desempenho por SDR"
        icon={Users}
        iconColor="text-indigo-500"
        loading={loadingDash}
        empty={activeSdrData.length === 0}
        emptyTitle="Nenhum SDR ativo"
        skeletonVariant="table"
        skeletonRows={3}
      >
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
              <tr key={sdr.sdr} className="border-b border-[#2a3147] hover:bg-[#0f1117] transition-colors">
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
      </ChartContainer>

      {/* Meta do mês */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5 card-hover animate-in stagger-10">
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
          <div className="h-3 rounded-full bg-indigo-500 bar-grow" style={{ width: '78%' }} />
        </div>
        <p className="text-xs text-slate-500 mt-2">78% da meta atingida — faltam 11 reuniões para bater o objetivo mensal.</p>
      </div>

      {/* IA card */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5 flex items-center justify-between card-hover animate-in stagger-10">
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
