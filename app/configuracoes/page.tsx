'use client';

import { useState } from 'react';
import { useApp } from '@/contexts/AppContext';
import {
  Settings, Zap, Webhook, Sliders, CheckCircle, GitBranch,
  Users, ChevronDown, ChevronUp, Bot, User, ExternalLink, Save,
} from 'lucide-react';
import { getCanalBadgeClasses, formatDateTime } from '@/lib/utils';

type Tab = 'integracoes' | 'cadencias' | 'webhooks' | 'parametros';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'integracoes', label: 'Integrações', icon: Zap },
  { id: 'cadencias', label: 'Cadências', icon: GitBranch },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook },
  { id: 'parametros', label: 'Parâmetros', icon: Sliders },
];

function IntegracaoCard({
  name, status, description, fields,
}: {
  name: string;
  status: 'ativo' | 'inativo' | 'pendente';
  description: string;
  fields: { label: string; value: string; type?: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-[#0f1117] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${status === 'ativo' ? 'bg-green-500' : status === 'inativo' ? 'bg-slate-600' : 'bg-amber-400'}`} />
          <div>
            <span className="font-semibold text-slate-200">{name}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
              status === 'ativo' ? 'bg-green-500/20 text-green-400' :
              status === 'inativo' ? 'bg-[#252b3b] text-slate-400' :
              'bg-amber-500/20 text-amber-400'}`}>
              {status === 'ativo' ? 'Ativo' : status === 'inativo' ? 'Inativo' : 'Pendente'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500 hidden sm:block">{description}</span>
          {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </div>
      {open && (
        <div className="border-t border-[#2a3147] px-5 py-4 space-y-3 bg-[#0f1117]">
          {fields.map(f => (
            <div key={f.label}>
              <label className="text-xs font-medium text-slate-300 block mb-1">{f.label}</label>
              <input
                type={f.type ?? 'text'}
                defaultValue={f.value}
                className="w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm bg-[#1a1f2e] focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg" style={{ backgroundColor: '#1e3a5f' }}>
              <Save size={13} /> Salvar
            </button>
            <button className="text-sm text-slate-400 border border-[#2a3147] px-4 py-2 rounded-lg hover:bg-[#1a1f2e]">
              Testar conexão
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfiguracoesPage() {
  const { cadencias, empresas, templates, webhookLogs } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('integracoes');
  const [expandedCad, setExpandedCad] = useState<string | null>(cadencias[0]?.id ?? null);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Settings size={22} className="text-slate-300" />
            Configurações
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Integrações, cadências, webhooks e parâmetros da plataforma.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#252b3b] rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
              color: activeTab === tab.id ? '#1e3a5f' : '#6b7280',
              boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB: Integrações */}
      {activeTab === 'integracoes' && (
        <div className="space-y-4">
          <h2 className="font-semibold text-slate-300 text-sm uppercase tracking-wide">Automação</h2>
          <IntegracaoCard
            name="n8n Automation"
            status="ativo"
            description="Orquestrador principal de automações"
            fields={[
              { label: 'URL do n8n', value: 'https://n8n.inovacode.com.br' },
              { label: 'API Key', value: '••••••••••••••••', type: 'password' },
              { label: 'Webhook Base URL', value: 'https://n8n.inovacode.com.br/webhook/' },
            ]}
          />
          <h2 className="font-semibold text-slate-300 text-sm uppercase tracking-wide pt-2">Canais de Comunicação</h2>
          <IntegracaoCard
            name="LinkedIn"
            status="ativo"
            description="Envio de mensagens e conexões"
            fields={[
              { label: 'Cookie de sessão (li_at)', value: '••••••••••••••••', type: 'password' },
              { label: 'Limite diário de envios', value: '50' },
            ]}
          />
          <IntegracaoCard
            name="Email (SMTP)"
            status="ativo"
            description="Envio de e-mails via SMTP"
            fields={[
              { label: 'Servidor SMTP', value: 'smtp.gmail.com' },
              { label: 'Porta', value: '587' },
              { label: 'Usuário', value: 'prospeccao@inovacode.com.br' },
              { label: 'Senha', value: '••••••••', type: 'password' },
            ]}
          />
          <IntegracaoCard
            name="WhatsApp (Evolution API)"
            status="pendente"
            description="Envio de mensagens WhatsApp"
            fields={[
              { label: 'URL da Evolution API', value: 'https://api.inovacode.com.br' },
              { label: 'Instância', value: 'prospeccao-01' },
              { label: 'API Key', value: '••••••••', type: 'password' },
            ]}
          />
          <IntegracaoCard
            name="Telefone (VoIP)"
            status="inativo"
            description="Ligações via VoIP integrado"
            fields={[
              { label: 'Provedor', value: 'Twilio' },
              { label: 'Account SID', value: '' },
              { label: 'Auth Token', value: '', type: 'password' },
            ]}
          />
        </div>
      )}

      {/* TAB: Cadências */}
      {activeTab === 'cadencias' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">{cadencias.length} cadências configuradas</p>
            <button
              className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              <GitBranch size={14} /> Nova Cadência
            </button>
          </div>
          {cadencias.map(cad => {
            const leadsAtivos = empresas.filter(e => e.cadencia_id === cad.id && e.em_cadencia);
            const isOpen = expandedCad === cad.id;
            const tplList = templates.filter(t => cad.etapas.map(e => e.template_id).includes(t.id));
            const avgRate = tplList.length > 0
              ? Math.round(tplList.reduce((s, t) => s + t.taxa_resposta, 0) / tplList.length) : 0;
            return (
              <div key={cad.id} className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
                <div
                  className="flex items-center justify-between p-5 cursor-pointer hover:bg-[#0f1117]"
                  onClick={() => setExpandedCad(isOpen ? null : cad.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                      <GitBranch size={18} className="text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{cad.nome}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${cad.ativa ? 'bg-green-500/20 text-green-400' : 'bg-[#252b3b] text-slate-400'}`}>
                          {cad.ativa ? 'Ativa' : 'Inativa'}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400 mt-0.5">{cad.descricao}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className="flex items-center gap-1 text-sm font-bold text-indigo-400"><Users size={13} /> {leadsAtivos.length}</div>
                      <div className="text-xs text-slate-500">leads ativos</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-green-400">{avgRate}%</div>
                      <div className="text-xs text-slate-500">taxa média</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-bold text-slate-300">{cad.etapas.length}</div>
                      <div className="text-xs text-slate-500">etapas</div>
                    </div>
                    {isOpen ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-[#2a3147] px-5 py-4">
                    <div className="flex gap-0 items-start overflow-x-auto pb-2">
                      {cad.etapas.map((etapa, i) => {
                        const tpl = templates.find(t => t.id === etapa.template_id);
                        const isLast = i === cad.etapas.length - 1;
                        return (
                          <div key={etapa.numero} className="flex items-start">
                            <div className="flex flex-col items-center min-w-40 max-w-44 px-2">
                              <div className="flex items-center w-full">
                                <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-bold shrink-0">
                                  {etapa.numero}
                                </div>
                                {!isLast && <div className="flex-1 h-0.5 bg-indigo-500/20 mx-1" />}
                              </div>
                              <div className="mt-2 w-full">
                                <div className="text-xs font-semibold text-slate-300">D+{etapa.dia_offset}</div>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(etapa.canal)} block w-fit mt-1`}>
                                  {etapa.canal}
                                </span>
                                <div className={`text-xs mt-1 flex items-center gap-1 ${etapa.executado_por === 'automatico' ? 'text-blue-400' : 'text-green-400'}`}>
                                  {etapa.executado_por === 'automatico' ? <Bot size={11} /> : <User size={11} />}
                                  {etapa.executado_por === 'automatico' ? 'Auto' : 'Manual'}
                                </div>
                                {tpl && <div className="text-xs text-slate-500 mt-1 leading-tight truncate">{tpl.nome}</div>}
                                {tpl && <div className="text-xs text-green-400 mt-0.5">{tpl.taxa_resposta}% resp.</div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {leadsAtivos.length > 0 && (
                      <div className="mt-4 border-t border-[#2a3147] pt-4">
                        <div className="text-xs font-semibold text-slate-400 mb-2">Leads nesta cadência</div>
                        <div className="flex flex-wrap gap-2">
                          {leadsAtivos.map(e => (
                            <a key={e.id} href={`/leads/${e.id}`}
                              className="text-xs bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-full hover:bg-indigo-500/20 transition-colors">
                              {e.nome} — Etapa {e.etapa_atual_cadencia}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Regras de Automação */}
          <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
            <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />
              Regras de Automação (n8n)
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a3147]">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium text-xs">Gatilho</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium text-xs">Condição</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium text-xs">Ação Automática</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {[
                  { gatilho: 'lead.criado', cond: 'Lead entra com status "novo"', acao: 'Inicia cadência padrão do segmento' },
                  { gatilho: 'abordagem.sem_resposta', cond: 'X dias sem resposta após envio', acao: 'Dispara próxima etapa da cadência' },
                  { gatilho: 'resposta.detectada', cond: 'Qualquer resposta recebida', acao: 'Para cadência, notifica responsável, atualiza status' },
                  { gatilho: 'resposta.positiva', cond: 'Tipo: interesse_positivo', acao: 'Para cadência, cria follow-up urgente, sinaliza no dashboard' },
                  { gatilho: 'resposta.opt_out', cond: 'Tipo: opt_out ou negativa_definitiva', acao: 'Adiciona à blacklist, para toda automação' },
                  { gatilho: 'cadencia.finalizada', cond: 'Última etapa sem resposta', acao: 'Status → reativar_futuramente, define data futura' },
                  { gatilho: 'followup.atrasado', cond: 'Data prevista < hoje e status "pendente"', acao: 'Alerta responsável, aparece no dashboard' },
                  { gatilho: 'lead.inativo', cond: 'Sem interação há 14+ dias sem cadência', acao: 'Alerta para retomada manual' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-[#2a3147] hover:bg-[#0f1117]">
                    <td className="py-2 px-3">
                      <code className="bg-[#252b3b] text-slate-300 px-1.5 py-0.5 rounded text-xs">{row.gatilho}</code>
                    </td>
                    <td className="py-2 px-3 text-slate-300">{row.cond}</td>
                    <td className="py-2 px-3 text-slate-300">{row.acao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Webhooks */}
      {activeTab === 'webhooks' && (
        <div className="space-y-4">
          <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-200 flex items-center gap-2">
                <Webhook size={16} className="text-purple-500" />
                Log de Webhooks
              </h2>
              <span className="text-xs text-slate-500">{webhookLogs.length} eventos registrados</span>
            </div>
            <div className="space-y-2">
              {[...webhookLogs].reverse().map(log => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-[#2a3147] hover:bg-[#0f1117] transition-colors">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    log.status === 'disparado' ? 'bg-green-500' :
                    log.status === 'simulado' ? 'bg-indigo-400' : 'bg-red-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-semibold text-slate-300 bg-[#252b3b] px-2 py-0.5 rounded">
                        {log.evento}
                      </code>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        log.status === 'disparado' ? 'bg-green-500/20 text-green-400' :
                        log.status === 'simulado' ? 'bg-indigo-500/20 text-indigo-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {log.status}
                      </span>
                      {log.empresa_id && (
                        <a href={`/leads/${log.empresa_id}`} className="text-xs text-indigo-400 hover:underline flex items-center gap-0.5">
                          ver lead <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatDateTime(log.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB: Parâmetros */}
      {activeTab === 'parametros' && (
        <div className="space-y-5">
          <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
            <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Sliders size={16} className="text-indigo-500" />
              Parâmetros da Plataforma
            </h2>
            <div className="space-y-4">
              {[
                { label: 'Limite diário de envios por SDR', value: '50', desc: 'Número máximo de mensagens por responsável por dia.' },
                { label: 'Intervalo mínimo entre mensagens (horas)', value: '24', desc: 'Tempo mínimo entre dois envios para o mesmo contato.' },
                { label: 'Dias até considerar lead inativo', value: '14', desc: 'Leads sem contato por este período geram alerta no dashboard.' },
                { label: 'Score mínimo para qualificação', value: '30', desc: 'Score de engajamento mínimo para mover para a fila ativa.' },
                { label: 'E-mail de notificações', value: 'gestao@inovacode.com.br', desc: 'Destinatário dos alertas automáticos da plataforma.' },
              ].map(param => (
                <div key={param.label} className="grid grid-cols-3 gap-4 items-start py-3 border-b border-[#2a3147] last:border-0">
                  <div className="col-span-2">
                    <label className="text-sm font-semibold text-slate-300">{param.label}</label>
                    <p className="text-xs text-slate-500 mt-0.5">{param.desc}</p>
                  </div>
                  <input
                    defaultValue={param.value}
                    className="border border-[#2a3147] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 bg-[#1a1f2e]"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button className="flex items-center gap-2 text-sm font-medium text-white px-5 py-2.5 rounded-lg" style={{ backgroundColor: '#1e3a5f' }}>
                <Save size={14} /> Salvar parâmetros
              </button>
              <button className="text-sm text-slate-400 border border-[#2a3147] px-4 py-2.5 rounded-lg hover:bg-[#0f1117]">
                Restaurar padrão
              </button>
            </div>
          </div>

          <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none p-5">
            <h2 className="font-semibold text-slate-200 mb-4">Status do sistema</h2>
            <div className="space-y-3">
              {[
                { name: 'n8n Automation', status: true },
                { name: 'LinkedIn API', status: true },
                { name: 'Email SMTP', status: true },
                { name: 'WhatsApp Evolution', status: false },
                { name: 'Banco de dados', status: true },
              ].map(s => (
                <div key={s.name} className="flex items-center gap-3">
                  <CheckCircle size={14} className={s.status ? 'text-green-500' : 'text-slate-600'} />
                  <span className="text-sm text-slate-300">{s.name}</span>
                  <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${s.status ? 'bg-green-500/20 text-green-400' : 'bg-[#252b3b] text-slate-500'}`}>
                    {s.status ? 'Operacional' : 'Desconectado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
