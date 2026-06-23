'use client';

import { useApp } from '@/contexts/AppContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { getCanalBadgeClasses } from '@/lib/utils';
import { BarChart2, Bot, User, TrendingUp } from 'lucide-react';


const TODAY = '2026-06-15';

function getWeekLabel(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().substring(5, 10); // MM-DD
}

export default function AnalisePage() {
  const { abordagens, respostas, templates, empresas, followUps } = useApp();

  // Response rate by canal
  const porCanal = ['LinkedIn', 'Email', 'WhatsApp', 'Telefone'].map(canal => {
    const sent = abordagens.filter(a => a.canal === canal).length;
    const received = respostas.filter(r => {
      const abr = abordagens.find(a => a.id === r.abordagem_id);
      return abr?.canal === canal;
    }).length;
    return {
      canal,
      enviadas: sent,
      respostas: received,
      taxa: sent > 0 ? Math.round((received / sent) * 100) : 0,
    };
  }).filter(d => d.enviadas > 0);

  // Response rate by template
  const porTemplate = templates
    .filter(t => t.total_usos > 0)
    .sort((a, b) => b.taxa_resposta - a.taxa_resposta)
    .slice(0, 6);

  // Responses by type
  const porTipo = [
    { tipo: 'Interesse Positivo', key: 'interesse_positivo', color: '#22c55e' },
    { tipo: 'Pediu Mais Info', key: 'pediu_mais_info', color: '#06b6d4' },
    { tipo: 'Sem Interesse', key: 'sem_interesse_agora', color: '#f97316' },
    { tipo: 'Não é o Decisor', key: 'nao_e_o_decisor', color: '#f59e0b' },
    { tipo: 'Negativa Definitiva', key: 'negativa_definitiva', color: '#ef4444' },
    { tipo: 'Opt-out', key: 'opt_out', color: '#7f1d1d' },
  ].map(item => ({
    ...item,
    count: respostas.filter(r => r.tipo === item.key).length,
  })).filter(d => d.count > 0);

  // Auto vs Human
  const autoAbordagens = abordagens.filter(a => a.origem_acao === 'automatico').length;
  const humanAbordagens = abordagens.filter(a => a.origem_acao === 'humano').length;
  const autoRespostas = respostas.filter(r => r.detectado_por === 'automatico').length;
  const humanRespostas = respostas.filter(r => r.detectado_por === 'humano').length;

  // Weekly comparison: last 6 weeks
  const weeklyData: Record<string, { semana: string; abordagens: number; respostas: number }> = {};
  const now = new Date(TODAY);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const wk = getWeekLabel(d);
    if (!weeklyData[wk]) weeklyData[wk] = { semana: wk, abordagens: 0, respostas: 0 };
  }
  abordagens.forEach(a => {
    const wk = getWeekLabel(new Date(a.data.substring(0, 10)));
    if (weeklyData[wk]) weeklyData[wk].abordagens++;
  });
  respostas.forEach(r => {
    const wk = getWeekLabel(new Date(r.data.substring(0, 10)));
    if (weeklyData[wk]) weeklyData[wk].respostas++;
  });
  const weeklyChart = Object.values(weeklyData);

  // Response rate by segment
  const SEGMENTOS = ['Logística', 'Petróleo', 'Mineração', 'Agro', 'Indústria', 'Varejo', 'Outro'] as const;
  const porSegmento = SEGMENTOS.map(seg => {
    const leadsNoSeg = empresas.filter(e => e.segmento === seg);
    const empIds = new Set(leadsNoSeg.map(e => e.id));
    const abrsNoSeg = abordagens.filter(a => empIds.has(a.empresa_id)).length;
    const respsNoSeg = respostas.filter(r => empIds.has(r.empresa_id)).length;
    const positivosNoSeg = leadsNoSeg.filter(e => e.status === 'respondeu_positivo' || e.status === 'pediu_mais_info').length;
    return {
      segmento: seg,
      leads: leadsNoSeg.length,
      abordagens: abrsNoSeg,
      respostas: respsNoSeg,
      positivos: positivosNoSeg,
      taxa: abrsNoSeg > 0 ? Math.round((respsNoSeg / abrsNoSeg) * 100) : 0,
    };
  }).filter(s => s.leads > 0).sort((a, b) => b.taxa - a.taxa);

  // Response rate by responsible
  const responsaveis = ['João Silva', 'Ana Costa', 'Pedro Nunes', 'Mariana Souza'];
  const porResponsavel = responsaveis.map(resp => {
    const abrs = abordagens.filter(a => a.responsavel === resp || (a.responsavel === 'n8n / Automação' && empresas.find(e => e.id === a.empresa_id)?.responsavel === resp));
    const resps = respostas.filter(r => {
      const emp = empresas.find(e => e.id === r.empresa_id);
      return emp?.responsavel === resp;
    });
    return {
      responsavel: resp.split(' ')[0],
      abordagens: abrs.length,
      respostas: resps.length,
      taxa: abrs.length > 0 ? Math.round((resps.length / abrs.length) * 100) : 0,
    };
  });

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Painel de Análise</h1>
        <p className="text-slate-400 text-sm mt-0.5">Performance de cadências, canais e templates</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Abordagens', value: abordagens.length, sub: `${autoAbordagens} auto · ${humanAbordagens} manual`, color: '#1e3a5f' },
          { label: 'Respostas Recebidas', value: respostas.length, sub: `${autoRespostas} auto · ${humanRespostas} manual`, color: '#22c55e' },
          { label: 'Taxa Global de Resposta', value: `${abordagens.length > 0 ? Math.round((respostas.length / abordagens.length) * 100) : 0}%`, sub: 'total abordagens vs respostas', color: '#6366f1' },
        ].map((kpi, i) => (
          <div key={i} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-4">
            <div className="text-xs text-slate-400 mb-1">{kpi.label}</div>
            <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-xs text-slate-500 mt-1">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Row 2: Canal chart + Response types */}
      <div className="grid grid-cols-2 gap-5">
        {/* Response rate by canal */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4">Taxa de Resposta por Canal</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={porCanal} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
              <XAxis dataKey="canal" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                formatter={(value, name) => [
                  name === 'taxa' ? `${value}%` : value,
                  name === 'taxa' ? 'Taxa de resposta' : name === 'enviadas' ? 'Enviadas' : 'Respostas'
                ]}
                contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }}
              />
              <Bar dataKey="enviadas" fill="#bfdbfe" name="enviadas" radius={[3, 3, 0, 0]} />
              <Bar dataKey="respostas" fill="#6366f1" name="respostas" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-2">
            {porCanal.map(c => (
              <div key={c.canal} className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(c.canal)}`}>{c.canal}</span>
                <div className="flex-1 bg-[#252b3b] rounded-full h-1.5">
                  <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${c.taxa}%` }} />
                </div>
                <span className="text-xs font-bold text-indigo-400 w-8 text-right">{c.taxa}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Response types pie */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4">Tipos de Resposta Recebida</h2>
          {porTipo.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-12">Nenhuma resposta registrada.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={porTipo} cx="50%" cy="50%" outerRadius={80} dataKey="count" nameKey="tipo" paddingAngle={2}>
                  {porTipo.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }}
                  formatter={(value, name) => [value, name]}
                />
                <Legend iconType="circle" iconSize={8}
                  formatter={(v) => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Template ranking */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-green-500" />
          Performance por Template
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">#</th>
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Template</th>
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Canal</th>
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Usos</th>
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Taxa de Resposta</th>
            </tr>
          </thead>
          <tbody>
            {porTemplate.map((t, i) => (
              <tr key={t.id} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-2.5 px-3 text-slate-500 text-xs font-bold">{i + 1}</td>
                <td className="py-2.5 px-3">
                  <div className="font-medium text-slate-200 text-sm">{t.nome}</div>
                </td>
                <td className="py-2.5 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(t.canal)}`}>{t.canal}</span>
                </td>
                <td className="py-2.5 px-3 text-slate-300 text-sm">{t.total_usos}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-[#252b3b] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${t.taxa_resposta}%` }} />
                    </div>
                    <span className="text-xs font-bold text-green-400">{t.taxa_resposta}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By responsible + auto vs human */}
      <div className="grid grid-cols-2 gap-5">
        {/* By responsible */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4">Performance por Responsável</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={porResponsavel} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
              <XAxis dataKey="responsavel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }} />
              <Bar dataKey="abordagens" fill="#bfdbfe" name="Abordagens" radius={[3,3,0,0]} />
              <Bar dataKey="respostas" fill="#22c55e" name="Respostas" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Auto vs human */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
          <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            Volume: Automático vs Humano
          </h2>
          <div className="space-y-4 mt-4">
            {[
              { label: 'Abordagens Automáticas', value: autoAbordagens, total: abordagens.length, icon: Bot, color: '#3b82f6' },
              { label: 'Abordagens Humanas', value: humanAbordagens, total: abordagens.length, icon: User, color: '#22c55e' },
              { label: 'Respostas detectadas (auto)', value: autoRespostas, total: respostas.length, icon: Bot, color: '#6366f1' },
              { label: 'Respostas detectadas (humano)', value: humanRespostas, total: respostas.length, icon: User, color: '#f59e0b' },
            ].map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 text-sm text-slate-300">
                    <item.icon size={14} style={{ color: item.color }} />
                    {item.label}
                  </span>
                  <span className="text-sm font-bold" style={{ color: item.color }}>
                    {item.value} <span className="text-xs text-slate-500 font-normal">/ {item.total}</span>
                  </span>
                </div>
                <div className="w-full bg-[#252b3b] rounded-full h-2">
                  <div className="h-2 rounded-full" style={{
                    width: item.total > 0 ? `${Math.round((item.value / item.total) * 100)}%` : '0%',
                    backgroundColor: item.color,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly comparison */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-indigo-500" />
          Comparativo Semanal — Abordagens vs Respostas
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={weeklyChart} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3147" />
            <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #2a3147', backgroundColor: '#1a1f2e', color: '#f1f5f9', fontSize: 12 }} />
            <Legend iconType="circle" iconSize={8}
              formatter={(v) => <span style={{ fontSize: 11, color: '#64748b' }}>{v}</span>} />
            <Line type="monotone" dataKey="abordagens" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Abordagens" />
            <Line type="monotone" dataKey="respostas" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Respostas" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Segment analysis */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
        <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <BarChart2 size={16} className="text-cyan-500" />
          Taxa de Resposta por Segmento
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3147]">
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Segmento</th>
              <th className="text-right py-2 px-3 text-slate-400 text-xs font-medium">Leads</th>
              <th className="text-right py-2 px-3 text-slate-400 text-xs font-medium">Abordagens</th>
              <th className="text-right py-2 px-3 text-slate-400 text-xs font-medium">Respostas</th>
              <th className="text-right py-2 px-3 text-slate-400 text-xs font-medium">Positivos</th>
              <th className="text-left py-2 px-3 text-slate-400 text-xs font-medium">Taxa</th>
            </tr>
          </thead>
          <tbody>
            {porSegmento.map(s => (
              <tr key={s.segmento} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                <td className="py-2.5 px-3">
                  <span className="text-xs px-2 py-0.5 bg-[#252b3b] text-slate-300 rounded-full font-medium">{s.segmento}</span>
                </td>
                <td className="py-2.5 px-3 text-right text-slate-300 text-sm">{s.leads}</td>
                <td className="py-2.5 px-3 text-right text-slate-300 text-sm">{s.abordagens}</td>
                <td className="py-2.5 px-3 text-right text-slate-300 text-sm">{s.respostas}</td>
                <td className="py-2.5 px-3 text-right">
                  <span className={`text-xs font-semibold ${s.positivos > 0 ? 'text-green-400' : 'text-slate-500'}`}>{s.positivos}</span>
                </td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 bg-[#252b3b] rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-cyan-500" style={{ width: `${Math.min(s.taxa, 100)}%` }} />
                    </div>
                    <span className="text-xs font-bold text-cyan-400 w-8">{s.taxa}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
