'use client';

import { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import { Users, Plus, Mail, Phone, ExternalLink } from 'lucide-react';
import { getCanalBadgeClasses } from '@/lib/utils';
import { SdrPill, SdrCircle } from '@/components/ui/SdrAvatar';

const TODAY = '2026-06-16';

const MEMBER_COLORS = {
  Francisca: { bg: '#e0e7ff', text: '#4f46e5', accent: '#6366f1' },
  Silmara: { bg: '#fce7f3', text: '#be185d', accent: '#ec4899' },
};

const META_MES = { Francisca: 20, Silmara: 20 };

const RECENT_ACTIVITY = {
  Francisca: [
    { data: '2026-06-14', empresa: 'AgroFast Soluções', acao: 'Lead adicionado', canal: 'LinkedIn' },
    { data: '2026-06-09', empresa: 'TransOil Logística', acao: 'Mensagem enviada', canal: 'Email' },
    { data: '2026-06-05', empresa: 'TransOil Logística', acao: 'Abordagem inicial', canal: 'LinkedIn' },
    { data: '2026-06-04', empresa: 'GranjaDigital Agro', acao: 'Follow-up realizado', canal: 'WhatsApp' },
    { data: '2026-06-01', empresa: 'GranjaDigital Agro', acao: 'Abordagem inicial', canal: 'WhatsApp' },
    { data: '2026-06-01', empresa: 'LogTech Brasil', acao: 'Abordagem inicial', canal: 'LinkedIn' },
  ],
  Silmara: [
    { data: '2026-06-13', empresa: 'Metalúrgica Alfa', acao: 'Follow-up realizado', canal: 'LinkedIn' },
    { data: '2026-06-10', empresa: 'Metalúrgica Alfa', acao: 'Abordagem inicial', canal: 'LinkedIn' },
    { data: '2026-06-07', empresa: 'Ferrous Mining Brasil', acao: 'Mensagem enviada', canal: 'LinkedIn' },
    { data: '2026-06-03', empresa: 'Petro Sul S.A.', acao: 'Follow-up realizado', canal: 'LinkedIn' },
    { data: '2026-06-01', empresa: 'Ferrous Mining Brasil', acao: 'Mensagem enviada', canal: 'Email' },
    { data: '2026-05-24', empresa: 'Petro Sul S.A.', acao: 'Mensagem enviada', canal: 'Email' },
  ],
};

export default function EquipePage() {
  const { empresas, abordagens, respostas, followUps } = useApp();
  const [activeTab, setActiveTab] = useState<'Francisca' | 'Silmara'>('Francisca');

  const sdrData = (['Francisca', 'Silmara'] as const).map(sdr => {
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
    const encaminhados = leads.filter(e => e.status === 'respondeu_positivo' || e.estagio_pipeline === 'reuniao_agendada').length;
    const taxa = msgs > 0 ? Math.round((resps / msgs) * 100) : 0;
    const metaPct = Math.round((reunioes / META_MES[sdr]) * 100);
    return { sdr, leads: leads.length, msgs, resps, taxa, reunioes, encaminhados, metaPct };
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Equipe</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Acompanhe a performance e atividades do seu time comercial.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-600 focus:outline-none">
            <option>Últimos 30 dias</option>
            <option>Este mês</option>
            <option>Últimos 7 dias</option>
          </select>
          <button
            className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            <Plus size={14} /> Adicionar membro
          </button>
        </div>
      </div>

      {/* Member cards */}
      <div className="grid grid-cols-2 gap-5">
        {sdrData.map(member => {
          const colors = MEMBER_COLORS[member.sdr];
          return (
            <div key={member.sdr} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Card header */}
              <div className="px-6 py-5 flex items-start gap-4" style={{ borderBottom: `3px solid ${colors.accent}` }}>
                <SdrCircle name={member.sdr} />
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-gray-900">{member.sdr}</h3>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      Ativo
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">SDR — Prospecção B2B</p>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-0 border-b border-gray-100">
                {[
                  { label: 'Leads captados', value: member.leads },
                  { label: 'Mensagens enviadas', value: member.msgs },
                  { label: 'Taxa de resposta', value: `${member.taxa}%` },
                  { label: 'Reuniões agendadas', value: member.reunioes },
                  { label: 'Leads encaminhados', value: member.encaminhados },
                  { label: 'Respostas recebidas', value: member.resps },
                ].map((kpi, i) => (
                  <div key={i} className="px-5 py-3.5 border-r border-b border-gray-100 last:border-r-0">
                    <div className="text-xs text-gray-500 leading-tight mb-1">{kpi.label}</div>
                    <div className="text-xl font-bold" style={{ color: colors.accent }}>{kpi.value}</div>
                  </div>
                ))}
              </div>

              {/* Meta */}
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-gray-700">Meta do mês</span>
                  <span className="text-sm font-bold" style={{ color: colors.accent }}>{member.metaPct}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 mb-1">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{ width: `${Math.min(member.metaPct, 100)}%`, backgroundColor: colors.accent }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{member.reunioes} reuniões agendadas</span>
                  <span>Meta: {META_MES[member.sdr]}</span>
                </div>
                <button
                  className="mt-4 w-full text-sm font-medium py-2 rounded-xl border transition-colors hover:opacity-90"
                  style={{ borderColor: colors.accent, color: colors.accent, backgroundColor: colors.bg }}
                >
                  Ver detalhes
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparativo */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={16} className="text-indigo-500" />
          Comparativo do time
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {['Membro', 'Leads', 'Mensagens', 'Taxa de Resposta', 'Reuniões', 'Meta (%)'].map(h => (
                <th key={h} className={`py-2 px-4 text-xs text-gray-500 font-medium ${h === 'Membro' ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sdrData.map(member => {
              const colors = MEMBER_COLORS[member.sdr];
              return (
                <tr key={member.sdr} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3.5 px-4">
                    <SdrPill name={member.sdr} />
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-gray-700">{member.leads}</td>
                  <td className="py-3.5 px-4 text-right text-gray-600">{member.msgs}</td>
                  <td className="py-3.5 px-4 text-right">
                    <span className="font-semibold text-green-600">{member.taxa}%</span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-semibold text-gray-700">{member.reunioes}</td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(member.metaPct, 100)}%`, backgroundColor: colors.accent }} />
                      </div>
                      <span className="text-xs font-semibold w-8 text-right" style={{ color: colors.accent }}>{member.metaPct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {/* Totals */}
            <tr className="border-t-2 border-gray-200 bg-gray-50">
              <td className="py-3 px-4 font-bold text-gray-700">Total / Média</td>
              <td className="py-3 px-4 text-right font-bold text-gray-700">{sdrData.reduce((s, d) => s + d.leads, 0)}</td>
              <td className="py-3 px-4 text-right font-bold text-gray-700">{sdrData.reduce((s, d) => s + d.msgs, 0)}</td>
              <td className="py-3 px-4 text-right font-bold text-green-600">
                {Math.round(sdrData.reduce((s, d) => s + d.taxa, 0) / sdrData.length)}%
              </td>
              <td className="py-3 px-4 text-right font-bold text-gray-700">{sdrData.reduce((s, d) => s + d.reunioes, 0)}</td>
              <td className="py-3 px-4 text-right font-bold text-indigo-600">
                {Math.round(sdrData.reduce((s, d) => s + d.metaPct, 0) / sdrData.length)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Atividade recente */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Atividade recente</h2>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['Francisca', 'Silmara'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-4 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === tab ? MEMBER_COLORS[tab].bg : 'white',
                  color: activeTab === tab ? MEMBER_COLORS[tab].text : '#6b7280',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {RECENT_ACTIVITY[activeTab].map((act, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 transition-colors">
              <div className="text-xs text-gray-400 w-20 shrink-0">
                {new Date(act.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-800">{act.empresa}</span>
                <span className="text-sm text-gray-500 ml-2">{act.acao}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${getCanalBadgeClasses(act.canal as 'LinkedIn' | 'Email' | 'WhatsApp' | 'Telefone')}`}>
                {act.canal}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
