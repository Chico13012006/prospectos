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

const TODAY = '2026-06-16';

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

const funnelSteps = [
  { label: 'Encontrados', value: 1248, pct: '100%', color: '#1e3a5f', w: 100 },
  { label: 'Qualificados', value: 684, pct: '54,8%', color: '#2d5a8e', w: 88 },
  { label: 'Enviados', value: 522, pct: '41,8%', color: '#3b82f6', w: 74 },
  { label: 'Responderam', value: 74, pct: '14,2%', color: '#6366f1', w: 56 },
  { label: 'Interesse identificado', value: 21, pct: '4,0%', color: '#8b5cf6', w: 38 },
  { label: 'Encaminhados', value: 18, pct: '3,2%', color: '#22c55e', w: 26 },
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

export default function DashboardPage() {
  const { empresas, abordagens, respostas, followUps } = useApp();

  const leadsEncontrados = empresas.length;
  const leadsQualificados = empresas.filter(e => e.status !== 'novo' && !e.blacklist && e.status !== 'descartado').length;
  const mensagensEnviadas = abordagens.length;
  const respostasRecebidas = respostas.length;
  const leadsEncaminhados = empresas.filter(e => e.estagio_pipeline === 'reuniao_agendada' || e.status === 'respondeu_positivo').length;

  const nichoData = [
    { nicho: 'Logística', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Mineração', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Agro', positivos: 2, responsavel: 'Francisco' },
    { nicho: 'Indústria', positivos: 1, responsavel: 'Silmara' },
  ];

  const leadsInteresse = empresas.filter(
    e => e.status === 'respondeu_positivo' || e.status === 'pediu_mais_info'
  ).slice(0, 5);

  const sdrData = ['Francisco', 'Silmara'].map(sdr => {
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

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Monitore a prospecção, follow-ups e distribuição de leads em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <RefreshCw size={12} />
            Dados atualizados há 5 min
          </div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1e3a5f' }}
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
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-600 focus:outline-none"
          >
            <option>{label}</option>
          </select>
        ))}
        <button className="text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 bg-white hover:bg-gray-50">
          Atualizar
        </button>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'Leads Encontrados', value: leadsEncontrados, pct: '+12%', color: '#1e3a5f' },
          { label: 'Leads Qualificados', value: leadsQualificados, pct: '+8%', color: '#6366f1' },
          { label: 'Mensagens Enviadas', value: mensagensEnviadas, pct: '+23%', color: '#3b82f6' },
          { label: 'Respostas Recebidas', value: respostasRecebidas, pct: '+5%', color: '#22c55e' },
          { label: 'Leads Encaminhados', value: leadsEncaminhados, pct: '+40%', color: '#f59e0b' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-500 mb-2">{kpi.label}</div>
            <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-xs text-green-600 font-medium mt-1">{kpi.pct} vs. período anterior</div>
          </div>
        ))}
      </div>

      {/* Funil + Eficiência Follow-up */}
      <div className="grid grid-cols-5 gap-5">
        {/* Funil da IA */}
        <div className="col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Zap size={16} className="text-indigo-500" />
            Funil da IA
          </h2>
          <div className="flex gap-8">
            {/* Visual funnel */}
            <div className="flex flex-col items-center gap-1.5 py-1" style={{ minWidth: 120 }}>
              {funnelSteps.map(step => (
                <div
                  key={step.label}
                  className="h-7 flex items-center justify-center text-white text-xs font-semibold rounded"
                  style={{ width: `${step.w}%`, backgroundColor: step.color, minWidth: 40 }}
                >
                  {step.value}
                </div>
              ))}
            </div>
            {/* Table */}
            <table className="flex-1 text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-2 text-xs text-gray-500 font-medium">Etapa</th>
                  <th className="text-right pb-2 text-xs text-gray-500 font-medium">Qtd</th>
                  <th className="text-right pb-2 text-xs text-gray-500 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {funnelSteps.map(step => (
                  <tr key={step.label} className="border-b border-gray-50">
                    <td className="py-1.5 text-gray-700 text-sm">{step.label}</td>
                    <td className="py-1.5 text-right font-semibold text-sm" style={{ color: step.color }}>
                      {step.value.toLocaleString('pt-BR')}
                    </td>
                    <td className="py-1.5 text-right text-gray-500 text-sm">{step.pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Eficiência de Follow-up */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
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
              <div key={item.label} className="bg-gray-50 rounded-lg p-2.5">
                <div className="text-xs text-gray-500 leading-tight mb-1">{item.label}</div>
                <div className="text-lg font-bold text-gray-800">{item.value}</div>
                <div className="text-xs text-green-600 font-medium">{item.delta}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={followUpBars} margin={{ left: -25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="etapa" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="respostas" fill="#22c55e" name="Respostas" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Nicho + Leads interesse + Alertas */}
      <div className="grid grid-cols-3 gap-5">
        {/* Distribuição por nicho */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Target size={16} className="text-indigo-500" />
            Distribuição por nicho
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-1.5 text-xs text-gray-500 font-medium">Nicho</th>
                <th className="text-center py-1.5 text-xs text-gray-500 font-medium">Positivos</th>
                <th className="text-right py-1.5 text-xs text-gray-500 font-medium">Responsável</th>
              </tr>
            </thead>
            <tbody>
              {nichoData.map(n => (
                <tr key={n.nicho} className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">{n.nicho}</td>
                  <td className="py-2 text-center font-bold text-green-600">{n.positivos}</td>
                  <td className="py-2 text-right"><SdrPill name={n.responsavel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link href="/pipeline" className="mt-3 text-xs text-indigo-600 hover:underline flex items-center gap-1">
            Ver todos os nichos <ArrowRight size={11} />
          </Link>
        </div>

        {/* Fila de leads com interesse */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Users size={16} className="text-green-500" />
            Fila de leads com interesse
          </h2>
          <div className="space-y-2">
            {leadsInteresse.map(e => (
              <Link key={e.id} href={`/leads/${e.id}`}>
                <div className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{e.nome}</div>
                    <div className="text-xs text-gray-500">{e.segmento}</div>
                  </div>
                  <div className="shrink-0"><SdrPill name={e.responsavel} /></div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
                    e.estagio_pipeline === 'reuniao_agendada'
                      ? 'bg-green-100 text-green-700'
                      : e.status === 'pediu_mais_info'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {e.estagio_pipeline === 'reuniao_agendada' ? 'Encaminhado'
                      : e.status === 'pediu_mais_info' ? 'Novo' : 'Pendente'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <Link href="/pipeline" className="mt-3 text-xs text-indigo-600 hover:underline flex items-center gap-1">
            Ver todos os leads <ArrowRight size={11} />
          </Link>
        </div>

        {/* Alertas da automação */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            Alertas da automação
          </h2>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-red-50 border border-red-100">
              <span className="shrink-0">⚠️</span>
              <p className="text-sm text-red-700">
                {atrasados} automações com baixa taxa de resposta
              </p>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
              <span className="shrink-0">🟡</span>
              <p className="text-sm text-amber-700">
                12 leads com interesse identificado aguardando ação
              </p>
            </div>
            <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-blue-50 border border-blue-100">
              <span className="shrink-0">🔵</span>
              <p className="text-sm text-blue-700">1 nicho sem responsável definido</p>
            </div>
          </div>
          <Link href="/configuracoes" className="mt-3 text-xs text-indigo-600 hover:underline flex items-center gap-1">
            Ver todos os alertas <ArrowRight size={11} />
          </Link>
        </div>
      </div>

      {/* Evolução de prospecções */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
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
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="dia" tick={{ fontSize: 10 }} interval={4} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
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
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={16} className="text-indigo-500" />
          Desempenho por SDR
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {['SDR', 'Leads captados', 'Mensagens enviadas', 'Taxa de resposta', 'Reuniões agendadas'].map(h => (
                <th key={h} className={`py-2 px-3 text-xs text-gray-500 font-medium ${h === 'SDR' ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sdrData.map(sdr => (
              <tr key={sdr.sdr} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-3">
                  <SdrPill name={sdr.sdr} />
                </td>
                <td className="py-3 px-3 text-right font-semibold text-gray-700">{sdr.leads}</td>
                <td className="py-3 px-3 text-right text-gray-600">{sdr.msgs}</td>
                <td className="py-3 px-3 text-right font-semibold text-green-600">{sdr.taxa}%</td>
                <td className="py-3 px-3 text-right font-semibold text-gray-700">{sdr.reunioes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Meta do mês */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Target size={16} className="text-indigo-500" />
            Meta do mês
          </h2>
          <span className="text-sm font-bold text-indigo-600">78%</span>
        </div>
        <div className="flex items-center justify-between text-sm text-gray-500 mb-2">
          <span>Reuniões agendadas: <span className="font-bold text-gray-800">39</span></span>
          <span>Meta: <span className="font-bold text-gray-800">50</span></span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div className="h-3 rounded-full bg-indigo-500 transition-all" style={{ width: '78%' }} />
        </div>
        <p className="text-xs text-gray-400 mt-2">78% da meta atingida — faltam 11 reuniões para bater o objetivo mensal.</p>
      </div>

      {/* IA card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Bot size={20} className="text-green-600" />
          </div>
          <div>
            <div className="font-semibold text-gray-800">IA trabalhando 24/7</div>
            <p className="text-sm text-gray-500">Prospectando, qualificando e gerando oportunidades para seu time.</p>
          </div>
        </div>
        <Link
          href="/configuracoes"
          className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
        >
          Ver automações <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
