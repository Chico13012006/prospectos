'use client';

import { useApp } from '@/contexts/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { getCanalBadgeClasses } from '@/lib/utils';
import {
  Download, Save, RefreshCw, Brain, Lightbulb, TrendingUp, MapPin,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { getLeadsStats } from '@/lib/api';

const CANAL_COLORS: Record<string, string> = {
  LinkedIn: '#0077b5',
  Email: '#6366f1',
  WhatsApp: '#22c55e',
  Telefone: '#8b5cf6',
};

const evolucaoConversao = [
  { dia: '01/05', taxa: 1.8, media: 2.1 },
  { dia: '05/05', taxa: 2.2, media: 2.1 },
  { dia: '09/05', taxa: 1.9, media: 2.2 },
  { dia: '13/05', taxa: 2.5, media: 2.3 },
  { dia: '17/05', taxa: 2.1, media: 2.3 },
  { dia: '21/05', taxa: 2.8, media: 2.4 },
  { dia: '25/05', taxa: 2.4, media: 2.5 },
  { dia: '29/05', taxa: 3.1, media: 2.6 },
  { dia: '02/06', taxa: 2.9, media: 2.6 },
  { dia: '06/06', taxa: 3.4, media: 2.7 },
  { dia: '10/06', taxa: 3.2, media: 2.8 },
  { dia: '14/06', taxa: 3.5, media: 2.9 },
];

const followUpRespostas = [
  { label: 'Primeiro contato', respostas: 28, pct: 37 },
  { label: 'Follow-up 1', respostas: 27, pct: 36 },
  { label: 'Follow-up 2', respostas: 12, pct: 16 },
  { label: 'Follow-up 3', respostas: 6, pct: 8 },
  { label: 'Follow-up 4+', respostas: 3, pct: 3 },
];

const motivosNaoInteresse = [
  { name: 'Já possui fornecedor', value: 38, color: '#6366f1' },
  { name: 'Sem orçamento', value: 25, color: '#3b82f6' },
  { name: 'Sem projeto', value: 17, color: '#f59e0b' },
  { name: 'Não é o responsável', value: 12, color: '#22c55e' },
  { name: 'Não tem interesse', value: 8, color: '#ef4444' },
];

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const HOURS = ['08h', '09h', '10h', '11h', '12h', '13h', '14h', '15h', '16h', '17h', '18h', '19h'];
const heatmapData: Record<string, Record<string, number>> = {
  Seg: { '08h': 3, '09h': 7, '10h': 9, '11h': 8, '12h': 4, '13h': 2, '14h': 5, '15h': 6, '16h': 4, '17h': 3, '18h': 2, '19h': 1 },
  Ter: { '08h': 4, '09h': 8, '10h': 10, '11h': 9, '12h': 3, '13h': 2, '14h': 6, '15h': 7, '16h': 5, '17h': 4, '18h': 2, '19h': 1 },
  Qua: { '08h': 5, '09h': 9, '10h': 11, '11h': 8, '12h': 3, '13h': 3, '14h': 7, '15h': 6, '16h': 4, '17h': 3, '18h': 1, '19h': 1 },
  Qui: { '08h': 3, '09h': 7, '10h': 8, '11h': 7, '12h': 4, '13h': 2, '14h': 5, '15h': 5, '16h': 3, '17h': 2, '18h': 1, '19h': 0 },
  Sex: { '08h': 2, '09h': 5, '10h': 6, '11h': 5, '12h': 3, '13h': 1, '14h': 3, '15h': 4, '16h': 2, '17h': 1, '18h': 0, '19h': 0 },
  Sáb: { '08h': 0, '09h': 1, '10h': 2, '11h': 1, '12h': 0, '13h': 0, '14h': 1, '15h': 0, '16h': 0, '17h': 0, '18h': 0, '19h': 0 },
  Dom: { '08h': 0, '09h': 0, '10h': 1, '11h': 0, '12h': 0, '13h': 0, '14h': 0, '15h': 0, '16h': 0, '17h': 0, '18h': 0, '19h': 0 },
};

function heatColor(v: number): string {
  if (v >= 9) return '#1e3a5f';
  if (v >= 7) return '#2d5a8e';
  if (v >= 5) return '#3b82f6';
  if (v >= 3) return '#93c5fd';
  if (v >= 1) return '#dbeafe';
  return '#f8fafc';
}

export default function InteligenciaComercialPage() {
  const { abordagens, respostas, templates, empresas } = useApp();

  const [leadsData, setLeadsData] = useState<any[]>([])

  useEffect(() => {
    async function carregarIntel() {
      try {
        const stats = await getLeadsStats()
        if (stats && stats.length > 0) setLeadsData(stats)
      } catch (err) {
        console.error('Erro ao carregar inteligência comercial:', err)
      }
    }
    carregarIntel()
  }, [])

  const totalAbordagens = abordagens.length;
  const totalRespostas = respostas.length;

  // KPIs dinâmicos
  const leadsTotal = leadsData.length > 0 ? leadsData.length : totalAbordagens
  const interessados = leadsData.length > 0
    ? leadsData.filter((l: any) => l.estagio === 'interessado' || l.estagio === 'reuniao_agendada').length
    : 3
  const reunioes = leadsData.length > 0
    ? leadsData.filter((l: any) => l.estagio === 'reuniao_agendada').length
    : 1
  const taxaConversao = leadsData.length > 0
    ? `${(reunioes / leadsData.length * 100).toFixed(1)}%`
    : `${totalAbordagens > 0 ? ((totalRespostas / totalAbordagens) * 100).toFixed(1) : 0}%`

  const porCanal = (['LinkedIn', 'Email', 'WhatsApp', 'Telefone'] as const).map(canal => {
    const msgs = abordagens.filter(a => a.canal === canal).length;
    const resps = respostas.filter(r => {
      const abr = abordagens.find(a => a.id === r.abordagem_id);
      return abr?.canal === canal;
    }).length;
    const taxa = msgs > 0 ? ((resps / msgs) * 100).toFixed(2) : '0';
    const conv = msgs > 0 ? ((resps / msgs) * 100) : 0;
    return { canal, msgs, resps, taxa, conv };
  }).filter(d => d.msgs > 0);

  const canalLabels: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', linkedin: 'LinkedIn', telefone: 'Telefone' }
  const performanceCanal = ['email', 'whatsapp', 'linkedin', 'telefone'].map(canal => ({
    canal: canalLabels[canal],
    msgs: leadsData.filter((l: any) => l.canal_preferencial === canal).length,
    resps: 0,
    taxa: leadsData.length > 0 ? (leadsData.filter((l: any) => l.canal_preferencial === canal).length / leadsData.length * 100).toFixed(1) : '0',
    conv: leadsData.length > 0 ? leadsData.filter((l: any) => l.canal_preferencial === canal).length / leadsData.length * 100 : 0,
  })).filter(c => c.msgs > 0)
  const activeCanal = leadsData.length > 0 ? performanceCanal : porCanal

  const porSegmento = [
    { segmento: 'Logística', leads: 2, respostas: 0, conversao: 0 },
    { segmento: 'Agro', leads: 2, respostas: 2, conversao: 2.80 },
    { segmento: 'Indústria', leads: 2, respostas: 0, conversao: 0 },
    { segmento: 'Petróleo e Gás', leads: 2, respostas: 1, conversao: 1.42 },
    { segmento: 'Mineração', leads: 2, respostas: 2, conversao: 3.15 },
    { segmento: 'Outros', leads: 2, respostas: 1, conversao: 0.90 },
  ];

  const porSegmentoSupabase = leadsData.length > 0
    ? [...new Set(leadsData.map((l: any) => l.segmento))].map((seg: any) => ({
        segmento: seg,
        leads: leadsData.filter((l: any) => l.segmento === seg).length,
        respostas: leadsData.filter((l: any) => l.segmento === seg && l.estagio === 'reuniao_agendada').length,
        conversao: leadsData.filter((l: any) => l.segmento === seg).length > 0
          ? leadsData.filter((l: any) => l.segmento === seg && l.estagio === 'reuniao_agendada').length /
            leadsData.filter((l: any) => l.segmento === seg).length * 5
          : 0,
      }))
    : null
  const activeSegmentos = porSegmentoSupabase ?? porSegmento

  const geoDataFallback = [
    { estado: 'SP', respostas: 2 },
    { estado: 'MG', respostas: 3 },
    { estado: 'RJ', respostas: 1 },
    { estado: 'ES', respostas: 1 },
    { estado: 'PA', respostas: 0 },
    { estado: 'Outros', respostas: 0 },
  ]
  const porEstadoSupabase = leadsData.length > 0
    ? [...new Set(leadsData.map((l: any) => l.estado))].map((est: any) => ({
        estado: est,
        respostas: leadsData.filter((l: any) => l.estado === est).length,
      })).sort((a, b) => b.respostas - a.respostas)
    : null
  const activeGeoData = porEstadoSupabase ?? geoDataFallback

  const topTemplates = [...templates]
    .sort((a, b) => b.taxa_resposta - a.taxa_resposta)
    .slice(0, 5);


  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Inteligência Comercial</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Análises detalhadas para otimizar sua prospecção e automações.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-[#1a1f2e] border border-[#2a3147] rounded-lg px-3 py-2">
            <RefreshCw size={11} />
            Dados atualizados há 5 minutos
          </div>
          <button className="flex items-center gap-2 text-sm text-slate-300 border border-[#2a3147] px-3 py-2 rounded-lg hover:bg-[#0f1117]">
            <Save size={14} /> Salvar visão
          </button>
          <button className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg" style={{ backgroundColor: '#1e3a5f' }}>
            <Download size={14} /> Exportar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {['Período', 'Nicho', 'Canal', 'Responsável', 'Campanha', 'Região'].map(f => (
          <select key={f} className="text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none">
            <option>{f}</option>
          </select>
        ))}
        <button className="text-sm text-slate-400 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] hover:bg-[#0f1117]">
          + Mais filtros
        </button>
        <button className="text-sm text-indigo-400 hover:underline px-2">Limpar filtros</button>
      </div>

      {/* 6 KPI cards */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: 'Leads Abordados', value: leadsTotal, pct: '+14%', color: '#1e3a5f' },
          { label: 'Mensagens Enviadas', value: totalAbordagens, pct: '+23%', color: '#3b82f6' },
          { label: 'Respostas Recebidas', value: totalRespostas, pct: '+5%', color: '#22c55e' },
          { label: 'Interesses Positivos', value: interessados, pct: '+50%', color: '#f59e0b' },
          { label: 'Reuniões Agendadas', value: reunioes, pct: '0%', color: '#8b5cf6' },
          { label: 'Taxa de Conversão', value: taxaConversao, pct: '+2,1 p.p.', color: '#ef4444' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-3.5">
            <div className="text-xs text-slate-400 mb-2 leading-tight">{kpi.label}</div>
            <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-xs text-green-400 font-medium mt-1">{kpi.pct} vs. anterior</div>
          </div>
        ))}
      </div>

      {/* Performance por Canal */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4">Performance por Canal</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              {['Canal', 'Mensagens', 'Respostas', 'Taxa de Resposta', 'Conversão'].map(h => (
                <th key={h} className="py-2 px-3 text-xs text-slate-400 font-medium text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeCanal.map(c => (
              <tr key={c.canal} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-2.5 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(c.canal)}`}>{c.canal}</span>
                </td>
                <td className="py-2.5 px-3 text-slate-300">{c.msgs}</td>
                <td className="py-2.5 px-3 text-slate-300">{c.resps}</td>
                <td className="py-2.5 px-3 font-semibold text-indigo-400">{c.taxa}%</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-[#252b3b] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full" style={{ width: `${Math.min(c.conv, 100)}%`, backgroundColor: CANAL_COLORS[c.canal] ?? '#6366f1' }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-300">{c.taxa}%</span>
                  </div>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#2a3147] bg-[#0f1117]">
              <td className="py-2.5 px-3 font-semibold text-slate-300">Total</td>
              <td className="py-2.5 px-3 font-semibold text-slate-300">{totalAbordagens}</td>
              <td className="py-2.5 px-3 font-semibold text-slate-300">{totalRespostas}</td>
              <td className="py-2.5 px-3 font-semibold text-indigo-400">
                {totalAbordagens > 0 ? ((totalRespostas / totalAbordagens) * 100).toFixed(1) : 0}%
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Respostas por Follow-up + Motivos Não Interesse */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-1">Respostas por Follow-up</h2>
          <p className="text-xs text-indigo-400 font-medium mb-4">
            Insight: 63% das respostas foram recebidas após o primeiro follow-up.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={followUpRespostas} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }} />
              <Bar dataKey="respostas" fill="#6366f1" name="Respostas" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1">
            {followUpRespostas.map(f => (
              <div key={f.label} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-28 truncate">{f.label}</span>
                <div className="flex-1 bg-[#252b3b] rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-indigo-400" style={{ width: `${f.pct}%` }} />
                </div>
                <span className="text-xs font-semibold text-indigo-400 w-8 text-right">{f.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4">Motivos de Não Interesse</h2>
          <div className="flex gap-4">
            <ResponsiveContainer width="50%" height={180}>
              <PieChart>
                <Pie data={motivosNaoInteresse} cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                  dataKey="value" paddingAngle={2}>
                  {motivosNaoInteresse.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }} formatter={(v) => [`${v}%`, '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2 py-2">
              {motivosNaoInteresse.map(m => (
                <div key={m.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                  <span className="text-xs text-slate-300 flex-1 leading-tight">{m.name}</span>
                  <span className="text-xs font-bold text-slate-300">{m.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Taxa de Conversão por Segmento */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4">Taxa de Conversão por Segmento</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              {['Segmento', 'Leads', 'Respostas', 'Conversão'].map(h => (
                <th key={h} className="py-2 px-3 text-xs text-slate-400 font-medium text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeSegmentos.sort((a, b) => b.conversao - a.conversao).map(s => (
              <tr key={s.segmento} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-2.5 px-3">
                  <span className="text-xs px-2 py-0.5 bg-[#252b3b] text-slate-300 rounded-full font-medium">{s.segmento}</span>
                </td>
                <td className="py-2.5 px-3 text-slate-300">{s.leads}</td>
                <td className="py-2.5 px-3 text-slate-300">{s.respostas}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-28 bg-[#252b3b] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${Math.min(s.conversao * 20, 100)}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-green-400">{s.conversao.toFixed(2)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Heatmap + Distribuição Geográfica */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-1">Melhores Horários para Resposta</h2>
          <p className="text-xs text-indigo-400 font-medium mb-4">
            Insight: O período entre 08h e 11h apresenta a maior taxa de resposta.
          </p>
          <div className="overflow-x-auto">
            <div className="flex gap-1 mb-1">
              <div className="w-8 shrink-0" />
              {HOURS.map(h => (
                <div key={h} className="w-7 text-center text-xs text-slate-500">{h}</div>
              ))}
            </div>
            {DAYS.map(day => (
              <div key={day} className="flex gap-1 mb-1">
                <div className="w-8 text-xs text-slate-400 flex items-center">{day}</div>
                {HOURS.map(hour => {
                  const v = heatmapData[day]?.[hour] ?? 0;
                  return (
                    <div
                      key={hour}
                      title={`${day} ${hour}: ${v} respostas`}
                      className="w-7 h-6 rounded text-center text-xs flex items-center justify-center"
                      style={{ backgroundColor: heatColor(v), color: v >= 5 ? 'white' : 'transparent' }}
                    >
                      {v >= 7 ? v : ''}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-slate-500">Menor</span>
              {['#f8fafc', '#dbeafe', '#93c5fd', '#3b82f6', '#2d5a8e', '#1e3a5f'].map((c, i) => (
                <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: c }} />
              ))}
              <span className="text-xs text-slate-500">Maior</span>
            </div>
          </div>
        </div>

        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <MapPin size={16} className="text-indigo-500" />
            Distribuição Geográfica
          </h2>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {activeGeoData.filter(g => g.estado !== 'Outros').slice(0, 6).map(g => (
              <div key={g.estado}
                className="rounded-xl border border-[#2a3147] p-3 text-center"
                style={{ backgroundColor: g.respostas > 2 ? '#eff6ff' : g.respostas > 0 ? '#f0fdf4' : '#f9fafb' }}>
                <div className="text-lg font-bold" style={{ color: g.respostas > 2 ? '#1e3a5f' : g.respostas > 0 ? '#16a34a' : '#9ca3af' }}>
                  {g.estado}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{g.respostas} resp.</div>
              </div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3147]">
                <th className="text-left py-1.5 text-xs text-slate-400 font-medium">Estado</th>
                <th className="text-right py-1.5 text-xs text-slate-400 font-medium">Respostas</th>
              </tr>
            </thead>
            <tbody>
              {activeGeoData.map(g => (
                <tr key={g.estado} className="border-b border-[#2a3147]">
                  <td className="py-1.5 text-slate-300">{g.estado}</td>
                  <td className="py-1.5 text-right font-semibold text-indigo-400">{g.respostas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Performance de Templates Top 5 */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-500" />
          Performance de Templates (Top 5)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              {['#', 'Template', 'Mensagens', 'Respostas', 'Taxa de Resposta', 'Conversão'].map(h => (
                <th key={h} className={`py-2 px-3 text-xs text-slate-400 font-medium ${h === '#' || h === 'Template' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topTemplates.map((t, i) => (
              <tr key={t.id} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-2.5 px-3 text-xs font-bold text-slate-500">{i + 1}</td>
                <td className="py-2.5 px-3">
                  <div className="font-medium text-slate-200">{t.nome}</div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${getCanalBadgeClasses(t.canal)}`}>{t.canal}</span>
                </td>
                <td className="py-2.5 px-3 text-right text-slate-300">{t.total_usos}</td>
                <td className="py-2.5 px-3 text-right text-slate-300">
                  {Math.round(t.total_usos * t.taxa_resposta / 100)}
                </td>
                <td className="py-2.5 px-3 text-right font-semibold text-green-400">{t.taxa_resposta}%</td>
                <td className="py-2.5 px-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 bg-[#252b3b] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${t.taxa_resposta}%` }} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Insights + Recomendações */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Brain size={16} className="text-indigo-500" />
            Insights da IA
            <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full font-semibold ml-1">Novo</span>
          </h2>
          <ul className="space-y-3">
            {[
              'Leads de Logística convertem 3,4x mais que Mineração.',
              'WhatsApp possui maior taxa de conversão (3,49%), mesmo com menor volume.',
              'O primeiro follow-up é responsável por 36% de todas as respostas.',
              'Mensagens entre 08h e 11h têm 42% mais chances de resposta.',
              'Empresas com +100 funcionários respondem 47% mais que a média.',
            ].map((insight, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <p className="text-sm text-slate-300 leading-snug">{insight}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Lightbulb size={16} className="text-amber-500" />
            Recomendações da IA
          </h2>
          <div className="space-y-2.5">
            {[
              { text: 'Aumentar prospecção em Logística — +42% de conversão vs. média.', color: '#22c55e', bg: '#f0fdf4' },
              { text: 'Reduzir esforço em Mineração — baixo retorno vs. volume investido.', color: '#ef4444', bg: '#fef2f2' },
              { text: 'Garantir mínimo de 2 follow-ups — 63% das respostas vêm após o primeiro contato.', color: '#6366f1', bg: '#eff6ff' },
              { text: 'Priorizar WhatsApp para empresas do setor Agro.', color: '#22c55e', bg: '#f0fdf4' },
              { text: 'Concentrar envios entre 08h e 11h para maximizar taxa de resposta.', color: '#f59e0b', bg: '#fffbeb' },
            ].map((rec, i) => (
              <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl border" style={{ backgroundColor: rec.bg, borderColor: `${rec.color}30` }}>
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: rec.color }} />
                <p className="text-sm text-slate-300 leading-snug">{rec.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Evolução da Conversão */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500" />
          Evolução da Conversão — últimos 45 dias
        </h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={evolucaoConversao} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
            <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit="%" />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }}
              formatter={(v) => [`${v}%`, '']} />
            <Legend iconType="circle" iconSize={8}
              formatter={v => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
            <Line type="monotone" dataKey="taxa" stroke="#6366f1" strokeWidth={2.5}
              dot={{ r: 3, fill: '#6366f1' }} name="Taxa de Conversão" />
            <Line type="monotone" dataKey="media" stroke="#94a3b8" strokeWidth={1.5}
              strokeDasharray="5 5" dot={false} name="Média Móvel (7 dias)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
