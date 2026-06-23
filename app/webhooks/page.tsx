'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/contexts/AppContext';
import { formatDateTime } from '@/lib/utils';
import { Webhook, ChevronDown, ChevronUp, Copy, CheckCheck } from 'lucide-react';

const EVENT_COLORS: Record<string, string> = {
  'lead.criado': 'bg-blue-500/20 text-blue-400',
  'cadencia.proxima_etapa': 'bg-indigo-500/20 text-indigo-400',
  'resposta.detectada': 'bg-green-500/20 text-green-400',
  'resposta.positiva': 'bg-emerald-500/20 text-emerald-400',
  'resposta.opt_out': 'bg-red-500/20 text-red-400',
  'followup.atrasado': 'bg-amber-500/20 text-amber-400',
  'cadencia.finalizada': 'bg-purple-500/20 text-purple-400',
  'lead.inativo': 'bg-orange-500/20 text-orange-400',
};

const WEBHOOK_DOCS = [
  {
    evento: 'lead.criado',
    endpoint: 'POST /webhook/lead-criado',
    descricao: 'Disparado quando um novo lead é cadastrado. Inicia a cadência padrão do segmento.',
    payload: {
      evento: 'lead.criado',
      lead_id: 'uuid',
      empresa: 'Nome da empresa',
      segmento: 'Logística',
      responsavel: 'João',
      cadencia_id: 'uuid-cadencia-padrao',
      timestamp: '2026-06-15T10:00:00Z',
    },
  },
  {
    evento: 'resposta.detectada',
    endpoint: 'POST /webhook/resposta-detectada',
    descricao: 'Disparado quando uma resposta é recebida. Para cadência e notifica responsável.',
    payload: {
      evento: 'resposta.detectada',
      lead_id: 'uuid',
      tipo_resposta: 'interesse_positivo',
      parar_cadencia: true,
      notificar_responsavel: true,
      timestamp: '2026-06-15T10:00:00Z',
    },
  },
  {
    evento: 'cadencia.proxima_etapa',
    endpoint: 'POST /webhook/executar-etapa',
    descricao: 'Disparado para executar a próxima etapa da cadência com template e variáveis.',
    payload: {
      evento: 'cadencia.proxima_etapa',
      lead_id: 'uuid',
      cadencia_id: 'uuid',
      etapa: 2,
      canal: 'email',
      template_id: 'uuid',
      contato_email: 'contato@empresa.com',
      variaveis: { nome: 'Carlos', empresa: 'Empresa X', cargo: 'Diretor Logístico', segmento: 'Logística' },
    },
  },
];

export default function WebhooksPage() {
  const { webhookLogs, empresas } = useApp();
  const [filterEvento, setFilterEvento] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'log' | 'docs'>('log');

  const eventoOptions = Array.from(new Set(webhookLogs.map(w => w.evento))).sort();

  const filtered = useMemo(() => {
    let list = [...webhookLogs];
    if (filterEvento) list = list.filter(w => w.evento === filterEvento);
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [webhookLogs, filterEvento]);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Webhook size={22} /> Webhooks & Automação
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Log de eventos simulados para integração com n8n — {webhookLogs.length} eventos
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
        <div className="flex border-b border-[#2a3147]">
          {['log', 'docs'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'log' | 'docs')}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab === 'log' ? 'Log de Eventos' : 'Documentação'}
            </button>
          ))}
        </div>

        {/* LOG TAB */}
        {activeTab === 'log' && (
          <div className="p-5">
            {/* Filters */}
            <div className="flex gap-3 mb-4">
              <select value={filterEvento} onChange={e => setFilterEvento(e.target.value)}
                className="text-sm border border-[#2a3147] rounded-lg px-3 py-2 text-slate-300 focus:outline-none bg-[#1a1f2e]">
                <option value="">Todos os eventos</option>
                {eventoOptions.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
              {filterEvento && (
                <button onClick={() => setFilterEvento('')} className="text-xs text-slate-400 hover:text-slate-200 underline">
                  Limpar
                </button>
              )}
              <div className="ml-auto flex items-center gap-2 text-xs text-slate-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                🔵 MVP: todos os webhooks são simulados — sem chamadas reais ao n8n
              </div>
            </div>

            {/* Events list */}
            <div className="space-y-2">
              {filtered.map(log => {
                const isOpen = expanded === log.id;
                const emp = log.empresa_id ? empresas.find(e => e.id === log.empresa_id) : null;
                const badgeClass = EVENT_COLORS[log.evento] || 'bg-[#252b3b] text-slate-300';

                return (
                  <div key={log.id} className="border border-[#2a3147] rounded-xl overflow-hidden">
                    <div
                      className="flex items-center gap-3 p-3.5 cursor-pointer hover:bg-[#0f1117] transition-colors"
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                    >
                      {/* Status dot */}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        log.status === 'simulado' ? 'bg-blue-400' :
                        log.status === 'disparado' ? 'bg-green-500' : 'bg-red-500'
                      }`} />

                      {/* Event type */}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${badgeClass}`}>
                        {log.evento}
                      </span>

                      {/* Company */}
                      {emp && (
                        <span className="text-sm text-slate-300 min-w-0 truncate">{emp.nome}</span>
                      )}

                      <div className="ml-auto flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500">{formatDateTime(log.timestamp)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          log.status === 'simulado' ? 'bg-blue-500/10 text-blue-400' :
                          log.status === 'disparado' ? 'bg-green-500/10 text-green-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>
                          {log.status}
                        </span>
                        {isOpen ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[#2a3147] p-4 bg-[#0f1117]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-400">Payload JSON</span>
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(log.payload, null, 2), log.id)}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300"
                          >
                            {copied === log.id ? (
                              <><CheckCheck size={12} className="text-green-500" /> Copiado!</>
                            ) : (
                              <><Copy size={12} /> Copiar</>
                            )}
                          </button>
                        </div>
                        <pre className="text-xs text-slate-300 font-mono bg-[#1a1f2e] rounded-lg p-3 overflow-auto border border-[#2a3147] max-h-48">
                          {JSON.stringify(log.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DOCS TAB */}
        {activeTab === 'docs' && (
          <div className="p-5 space-y-5">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-300">
              <strong>Integração n8n:</strong> Os webhooks abaixo são os eventos que a plataforma ProspectOS emite para o n8n.
              No MVP, todos são simulados. Na v2, apontarão para o endpoint real do n8n.
            </div>
            {WEBHOOK_DOCS.map((doc, i) => (
              <div key={i} className="border border-[#2a3147] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between p-4 bg-[#0f1117] border-b border-[#2a3147]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${EVENT_COLORS[doc.evento] || 'bg-[#252b3b] text-slate-300'}`}>
                        {doc.evento}
                      </span>
                      <code className="text-sm font-mono text-slate-300">{doc.endpoint}</code>
                    </div>
                    <div className="text-sm text-slate-400 mt-1">{doc.descricao}</div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(doc.payload, null, 2), `doc-${i}`)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-300 shrink-0"
                  >
                    {copied === `doc-${i}` ? (
                      <><CheckCheck size={12} className="text-green-500" /> Copiado!</>
                    ) : (
                      <><Copy size={12} /> Copiar payload</>
                    )}
                  </button>
                </div>
                <div className="p-4">
                  <pre className="text-xs text-slate-300 font-mono bg-[#0f1117] rounded-lg p-3 overflow-auto border border-[#2a3147]">
                    {JSON.stringify(doc.payload, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
