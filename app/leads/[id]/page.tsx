'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/contexts/AppContext';
import {
  getStatusLabel, getStatusBadgeClasses,
  formatDate, formatDateTime, getOrigemIcon,
  getCanalBadgeClasses, getTipoRespostaLabel, getTipoRespostaBadgeClasses,
  getTipoAcaoLabel,
} from '@/lib/utils';
import {
  ChevronLeft, Bot, User, Phone, Mail, ExternalLink,
  MessageSquare, CheckCircle, AlertTriangle, Ban,
  PlusCircle, MessageCircle, Edit3, Building2, MapPin,
  Calendar, Clock, ChevronDown, X,
} from 'lucide-react';
import type { StatusLead } from '@/lib/types';

// Data real de hoje (YYYY-MM-DD) — antes fixa, causava dias negativos na UI.
const TODAY = new Date().toISOString().slice(0, 10);

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

function CanalIcon({ canal }: { canal: string }) {
  if (canal === 'LinkedIn') return <ExternalLink size={13} />;
  if (canal === 'Email') return <Mail size={13} />;
  if (canal === 'WhatsApp') return <MessageSquare size={13} />;
  if (canal === 'Telefone') return <Phone size={13} />;
  return null;
}

const STATUS_ALL: StatusLead[] = [
  'novo', 'em_prospeccao', 'aguardando_resposta', 'respondeu_positivo',
  'pediu_mais_info', 'sem_interesse_agora', 'reativar_futuramente', 'descartado', 'blacklist',
];

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const {
    getEmpresaById, getContatosByEmpresa, getFollowUpsByEmpresa,
    getTimelineForEmpresa, getTemplateById, updateEmpresa, updateFollowUp,
  } = useApp();

  const empresa = getEmpresaById(id);

  const [showAddAbordagem, setShowAddAbordagem] = useState(false);
  const [showAddResposta, setShowAddResposta] = useState(false);
  const [showAddFollowUp, setShowAddFollowUp] = useState(false);
  const [editingResumo, setEditingResumo] = useState(false);
  const [resumo, setResumo] = useState(empresa?.observacoes || '');
  const [showStatusChange, setShowStatusChange] = useState(false);

  if (!empresa) {
    return (
      <div className="p-6">
        <Link href="/pipeline" className="text-blue-400 hover:underline flex items-center gap-1 text-sm">
          <ChevronLeft size={15} /> Voltar
        </Link>
        <p className="mt-8 text-center text-slate-500">Lead não encontrado.</p>
      </div>
    );
  }

  const contatos = getContatosByEmpresa(id);
  const followUps = getFollowUpsByEmpresa(id);
  const timelineRaw = getTimelineForEmpresa(id);
  // Reverse: more recent first
  const timeline = [...timelineRaw].reverse();

  const contatoPrincipal = contatos.find(c => c.principal) || contatos[0];
  const pendingFollowUps = followUps.filter(f => f.status === 'pendente' || f.status === 'atrasado')
    .sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
  const proximoFup = pendingFollowUps[0];

  return (
    <div className="min-h-screen bg-[#0f1117]">

      {/* Compact header breadcrumb */}
      <div className="bg-[#1a1f2e] border-b border-[#2a3147] px-6 py-3 flex items-center gap-3">
        <Link href="/pipeline" className="text-slate-500 hover:text-slate-300 flex items-center gap-1 text-sm">
          <ChevronLeft size={15} /> Pipeline
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-sm font-semibold text-slate-200">{empresa.nome}</span>
        <span className="text-slate-600">—</span>
        <span className="text-sm text-slate-400">{empresa.segmento}</span>
        <span className="text-slate-600">—</span>
        <span className="text-sm text-slate-400 flex items-center gap-1">
          <MapPin size={13} /> {empresa.cidade}, {empresa.estado}
        </span>
        {empresa.blacklist && (
          <span className="ml-auto flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-full">
            <Ban size={11} /> Blacklist
          </span>
        )}
      </div>

      <div className="p-6 space-y-5 max-w-4xl">

        {/* 4 status cards */}
        <div className="grid grid-cols-4 gap-3">
          {/* Status */}
          <div className="h-20 bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-4 py-2.5 flex flex-col justify-center">
            <div className="text-xs text-slate-500 mb-1 font-medium">Status</div>
            <span className={`inline-flex w-fit text-sm px-2.5 py-1 rounded-full font-semibold ${getStatusBadgeClasses(empresa.status)}`}>
              {getStatusLabel(empresa.status)}
            </span>
          </div>

          {/* Responsável */}
          <div className="h-20 bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-4 py-2.5 flex flex-col justify-center">
            <div className="text-xs text-slate-500 mb-1 font-medium">Responsável</div>
            <div className="flex items-center gap-1.5">
              <User size={15} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-200">{empresa.responsavel}</span>
            </div>
          </div>

          {/* Último contato */}
          <div className="h-20 bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-4 py-2.5 flex flex-col justify-center">
            <div className="text-xs text-slate-500 mb-1 font-medium">Último contato</div>
            {empresa.ultimo_contato ? (
              <div className="flex items-center gap-1.5">
                {empresa.ultimo_contato_origem === 'automatico'
                  ? <Bot size={15} className="text-blue-400" />
                  : <User size={15} className="text-green-500" />}
                <span className="text-sm font-semibold text-slate-200">{formatDate(empresa.ultimo_contato)}</span>
                <span className="text-xs text-slate-500">
                  ({daysBetween(empresa.ultimo_contato, TODAY)}d atrás)
                </span>
              </div>
            ) : (
              <span className="text-sm text-slate-500">Nenhum contato</span>
            )}
          </div>

          {/* Próxima ação */}
          <div className={`h-20 rounded-xl border shadow-none px-4 py-2.5 flex flex-col justify-center ${
            proximoFup?.status === 'atrasado'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-[#1a1f2e] border-[#2a3147]'
          }`}>
            <div className="text-xs text-slate-500 mb-1 font-medium">Próxima ação</div>
            {proximoFup ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className={`text-sm font-semibold truncate ${proximoFup.status === 'atrasado' ? 'text-red-400' : 'text-slate-200'}`}>
                    {proximoFup.status === 'atrasado' && '⚠ '}
                    {getTipoAcaoLabel(proximoFup.tipo_acao)}
                  </div>
                  <div className={`text-xs mt-0.5 ${proximoFup.status === 'atrasado' ? 'text-red-500' : 'text-slate-400'}`}>
                    {formatDate(proximoFup.data_prevista)} · {proximoFup.canal_previsto}
                  </div>
                </div>
                {proximoFup.status === 'atrasado' && (
                  <button
                    onClick={() => updateFollowUp(proximoFup.id, { status: 'realizado' })}
                    className="shrink-0 text-xs font-medium text-white px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 transition-colors"
                  >
                    Registrar ação
                  </button>
                )}
              </div>
            ) : (
              <span className="text-sm text-slate-500">Sem follow-up</span>
            )}
          </div>
        </div>

        {/* Contato principal — linha compacta */}
        {contatoPrincipal && (
          <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-4 py-2.5 flex items-center gap-2.5 text-sm">
            <span className="font-semibold text-slate-100">{contatoPrincipal.nome}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">{contatoPrincipal.cargo}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${getCanalBadgeClasses(contatoPrincipal.canal_preferencial)}`}>
              {contatoPrincipal.canal_preferencial}
            </span>
            <div className="flex items-center gap-3 ml-auto text-slate-500">
              {contatoPrincipal.email && (
                <a href={`mailto:${contatoPrincipal.email}`} title={contatoPrincipal.email} className="hover:text-blue-400">
                  <Mail size={14} />
                </a>
              )}
              {contatoPrincipal.telefone && (
                <a href={`tel:${contatoPrincipal.telefone}`} title={contatoPrincipal.telefone} className="hover:text-blue-400">
                  <Phone size={14} />
                </a>
              )}
              {contatoPrincipal.linkedin_url && (
                <a href={`https://${contatoPrincipal.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                  title="LinkedIn" className="hover:text-blue-400">
                  <ExternalLink size={14} />
                </a>
              )}
              {contatos.length > 1 && (
                <span className="text-xs text-slate-500">+{contatos.length - 1}</span>
              )}
            </div>
          </div>
        )}

        {/* Resumo Rápido */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">Resumo Rápido</span>
            {!editingResumo && (
              <button onClick={() => setEditingResumo(true)}
                className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
                <Edit3 size={12} /> Editar
              </button>
            )}
          </div>
          {editingResumo ? (
            <div>
              <textarea
                value={resumo}
                onChange={e => setResumo(e.target.value)}
                rows={3}
                autoFocus
                className="w-full text-sm text-slate-300 border border-blue-500/30 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Contexto do lead: o que foi discutido, qual a dor, o que está esperando..."
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { updateEmpresa(id, { observacoes: resumo }); setEditingResumo(false); }}
                  className="text-xs font-medium text-white px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#1e3a5f' }}
                >
                  Salvar
                </button>
                <button
                  onClick={() => { setResumo(empresa.observacoes || ''); setEditingResumo(false); }}
                  className="text-xs text-slate-400 px-3 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#0f1117]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <p className={`text-sm leading-relaxed ${resumo ? 'text-slate-300' : 'text-slate-500 italic'}`}>
              {resumo || 'Nenhum resumo adicionado. Clique em Editar para descrever o contexto deste lead.'}
            </p>
          )}
        </div>

        {/* Timeline */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
          {/* Timeline header with action buttons */}
          <div className="px-5 py-4 border-b border-[#2a3147] flex items-center justify-between">
            <h2 className="font-semibold text-slate-200">Timeline</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddAbordagem(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-900 px-3 py-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
              >
                <PlusCircle size={13} /> Abordagem
              </button>
              <button
                onClick={() => setShowAddResposta(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-green-400 px-3 py-1.5 rounded-lg border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-colors"
              >
                <MessageCircle size={13} /> Resposta
              </button>
              <button
                onClick={() => setShowAddFollowUp(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-400 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors"
              >
                <Calendar size={13} /> Follow-up
              </button>
            </div>
          </div>

          {/* Timeline entries */}
          <div className="px-5 py-4 space-y-3">
            {timeline.length === 0 && (
              <div className="text-center text-slate-500 py-8 text-sm">
                Nenhuma interação registrada. Use os botões acima para registrar.
              </div>
            )}
            {timeline.map((entry, i) => {
              // Determine visual style
              let leftBorderColor = '#e2e8f0';
              let iconBg = 'bg-[#252b3b]';
              let iconEl: React.ReactNode = null;
              let titleEl: React.ReactNode = null;
              let bodyEl: React.ReactNode = null;
              let origemBadge: React.ReactNode = null;
              let timeStr = formatDateTime(entry.date);

              if (entry.kind === 'abordagem') {
                const a = entry.item;
                const isAuto = a.origem_acao === 'automatico';
                leftBorderColor = isAuto ? '#bfdbfe' : '#bbf7d0';
                iconBg = isAuto ? 'bg-blue-500/20' : 'bg-green-500/20';
                iconEl = isAuto
                  ? <Bot size={14} className="text-blue-400" />
                  : <User size={14} className="text-green-400" />;
                origemBadge = (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isAuto ? 'bg-blue-500/10 text-blue-400' : 'bg-green-500/10 text-green-400'}`}>
                    {isAuto ? '🤖 Automático' : '👤 Humano'}
                  </span>
                );
                titleEl = (
                  <span className="font-medium text-sm text-slate-100">
                    Abordagem via {a.canal}
                  </span>
                );
                bodyEl = (
                  <p className="text-sm text-slate-300 mt-1 bg-[#0f1117] rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-[#2a3147] line-clamp-4">
                    {a.mensagem_enviada}
                  </p>
                );
              } else if (entry.kind === 'resposta') {
                const r = entry.item;
                const isPositive = r.tipo === 'interesse_positivo' || r.tipo === 'pediu_mais_info';
                const isNeg = r.tipo === 'opt_out' || r.tipo === 'negativa_definitiva';
                leftBorderColor = isPositive ? '#86efac' : isNeg ? '#fca5a5' : '#fde68a';
                iconBg = isPositive ? 'bg-green-500/20' : isNeg ? 'bg-red-500/20' : 'bg-amber-500/20';
                iconEl = <MessageCircle size={14} className={isPositive ? 'text-green-400' : isNeg ? 'text-red-400' : 'text-amber-400'} />;
                origemBadge = (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTipoRespostaBadgeClasses(r.tipo)}`}>
                    {getTipoRespostaLabel(r.tipo)}
                  </span>
                );
                titleEl = <span className="font-medium text-sm text-slate-100">Resposta recebida</span>;
                bodyEl = (
                  <p className="text-sm text-slate-300 mt-1 bg-[#0f1117] rounded-lg p-3 italic border border-[#2a3147] leading-relaxed">
                    &ldquo;{r.conteudo}&rdquo;
                  </p>
                );
              } else if (entry.kind === 'webhook') {
                const w = entry.item;
                leftBorderColor = '#e9d5ff';
                iconBg = 'bg-purple-500/10';
                iconEl = <span className="text-purple-500 text-xs font-bold">⚡</span>;
                origemBadge = (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    automação
                  </span>
                );
                titleEl = <span className="font-medium text-sm text-slate-300">{w.evento}</span>;
                bodyEl = null;
              } else if (entry.kind === 'followup') {
                const f = entry.item;
                leftBorderColor = '#bbf7d0';
                iconBg = 'bg-green-500/20';
                iconEl = <CheckCircle size={14} className="text-green-400" />;
                origemBadge = <span className="text-xs text-slate-500">realizado</span>;
                titleEl = <span className="font-medium text-sm text-slate-100">{getTipoAcaoLabel(f.tipo_acao)}</span>;
                bodyEl = f.observacao ? <p className="text-xs text-slate-400 mt-1">{f.observacao}</p> : null;
              }

              return (
                <div
                  key={`${entry.kind}-${i}`}
                  className="flex gap-3"
                  style={{ borderLeft: `3px solid ${leftBorderColor}`, paddingLeft: '12px' }}
                >
                  <div className={`shrink-0 w-7 h-7 rounded-full ${iconBg} flex items-center justify-center`}>
                    {iconEl}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {titleEl}
                      {origemBadge}
                      <span className="text-xs text-slate-500 ml-auto shrink-0">{timeStr}</span>
                    </div>
                    {bodyEl}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Próximos Follow-ups */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none overflow-hidden">
          <div className="px-5 py-4 border-b border-[#2a3147] flex items-center justify-between">
            <h2 className="font-semibold text-slate-200">Próximos Follow-ups</h2>
            <button
              onClick={() => setShowAddFollowUp(true)}
              className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
            >
              <PlusCircle size={13} /> Novo
            </button>
          </div>
          <div className="px-5 py-3 space-y-2">
            {pendingFollowUps.length === 0 ? (
              <p className="text-sm text-slate-500 py-3">Nenhum follow-up pendente.</p>
            ) : (
              pendingFollowUps.map(f => (
                <div key={f.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
                  f.status === 'atrasado' ? 'border-red-500/30 bg-red-500/10' : 'border-[#2a3147] bg-[#0f1117]'
                }`}>
                  {f.status === 'atrasado'
                    ? <AlertTriangle size={14} className="text-red-500 shrink-0" />
                    : <Clock size={14} className="text-slate-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{getTipoAcaoLabel(f.tipo_acao)}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${getCanalBadgeClasses(f.canal_previsto)}`}>
                        {f.canal_previsto}
                      </span>
                      <span className="text-xs text-slate-500">{f.responsavel}</span>
                    </div>
                    {f.observacao && <div className="text-xs text-slate-400 mt-0.5 truncate">{f.observacao}</div>}
                  </div>
                  <div className={`text-xs font-semibold shrink-0 ${f.status === 'atrasado' ? 'text-red-400' : 'text-slate-400'}`}>
                    {formatDate(f.data_prevista)}
                    {f.status === 'atrasado' && ' ⚠'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Lead actions footer */}
        <div className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] shadow-none px-5 py-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <button
                onClick={() => setShowStatusChange(s => !s)}
                className="flex items-center gap-2 text-sm text-slate-300 border border-[#2a3147] px-3 py-2 rounded-lg hover:bg-[#0f1117] transition-colors"
              >
                Mudar status
                <ChevronDown size={14} />
              </button>
              {showStatusChange && (
                <div className="absolute bottom-full mb-1 left-0 bg-[#1a1f2e] border border-[#2a3147] rounded-xl shadow-lg py-1 z-10 min-w-48">
                  {STATUS_ALL.filter(s => s !== empresa.status).map(s => (
                    <button
                      key={s}
                      className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-[#0f1117] transition-colors"
                      onClick={() => { updateEmpresa(id, { status: s }); setShowStatusChange(false); }}
                    >
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${getStatusBadgeClasses(s)} mr-2`}>
                        {getStatusLabel(s)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="text-sm text-slate-300 border border-[#2a3147] px-3 py-2 rounded-lg hover:bg-[#0f1117] transition-colors">
              Transferir responsável
            </button>

            {!empresa.blacklist && (
              <button className="flex items-center gap-1.5 text-sm text-red-400 border border-red-500/30 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors">
                <Ban size={14} /> Adicionar à Blacklist
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal: Registrar Abordagem */}
      {showAddAbordagem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddAbordagem(false)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-100">Registrar Abordagem</h3>
              <button onClick={() => setShowAddAbordagem(false)}><X size={18} className="text-slate-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-300">Canal</label>
                <select className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm bg-[#1a1f2e]">
                  <option>LinkedIn</option><option>Email</option><option>WhatsApp</option><option>Telefone</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Mensagem enviada</label>
                <textarea rows={4} className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="Descreva o que foi enviado ou falado..." />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAddAbordagem(false)} className="flex-1 text-sm text-slate-300 border border-[#2a3147] rounded-lg py-2 hover:bg-[#0f1117]">Cancelar</button>
              <button onClick={() => setShowAddAbordagem(false)} className="flex-1 text-sm font-medium text-white rounded-lg py-2" style={{ backgroundColor: '#1e3a5f' }}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Registrar Resposta */}
      {showAddResposta && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddResposta(false)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-100">Registrar Resposta</h3>
              <button onClick={() => setShowAddResposta(false)}><X size={18} className="text-slate-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-300">Tipo de resposta</label>
                <select className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm bg-[#1a1f2e]">
                  <option value="interesse_positivo">✅ Interesse Positivo</option>
                  <option value="pediu_mais_info">📋 Pediu Mais Info</option>
                  <option value="sem_interesse_agora">⏸ Sem Interesse Agora</option>
                  <option value="nao_e_o_decisor">🔄 Não é o Decisor</option>
                  <option value="pedir_recontato">📅 Pediu Recontato</option>
                  <option value="negativa_definitiva">❌ Negativa Definitiva</option>
                  <option value="opt_out">🚫 Opt-out</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Conteúdo da resposta</label>
                <textarea rows={3} className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="Cole ou descreva o que o lead respondeu..." />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAddResposta(false)} className="flex-1 text-sm text-slate-300 border border-[#2a3147] rounded-lg py-2 hover:bg-[#0f1117]">Cancelar</button>
              <button onClick={() => setShowAddResposta(false)} className="flex-1 text-sm font-medium text-white rounded-lg py-2 bg-green-600">Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Follow-up */}
      {showAddFollowUp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAddFollowUp(false)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-100">Novo Follow-up</h3>
              <button onClick={() => setShowAddFollowUp(false)}><X size={18} className="text-slate-500" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-slate-300">Tipo de ação</label>
                  <select className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm bg-[#1a1f2e]">
                    <option value="ligar">Ligar</option>
                    <option value="enviar_mensagem">Enviar mensagem</option>
                    <option value="enviar_material">Enviar material</option>
                    <option value="reativar">Reativar</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-300">Canal</label>
                  <select className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm bg-[#1a1f2e]">
                    <option>LinkedIn</option><option>Email</option><option>WhatsApp</option><option>Telefone</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Data prevista</label>
                <input type="date" defaultValue={TODAY} className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Observação</label>
                <textarea rows={2} className="mt-1 w-full border border-[#2a3147] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-100" placeholder="O que precisa ser feito..." />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowAddFollowUp(false)} className="flex-1 text-sm text-slate-300 border border-[#2a3147] rounded-lg py-2 hover:bg-[#0f1117]">Cancelar</button>
              <button onClick={() => setShowAddFollowUp(false)} className="flex-1 text-sm font-medium text-white rounded-lg py-2" style={{ backgroundColor: '#6366f1' }}>Agendar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
