'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Star, ExternalLink, Mail, Phone,
  MessageSquare, Bot, User, ArrowRight, CheckCircle,
  FileText, Bell, Loader2, Clock, Plus,
} from 'lucide-react';
import { getStatusLabel, getStatusBadgeClasses, getEstagioPipelineLabel, formatDate, formatDateTime } from '@/lib/utils';
import { SdrPill, SdrCircle } from '@/components/ui/SdrAvatar';
import type { Empresa, Contato, EstagioPipeline } from '@/lib/types';
import { getLeadById, getInteracoesByLead, createInteracao, atualizarEstagio, registrarNota, executarAcao, updateLead } from '@/lib/api';
import type { Lead, Interacao } from '@/lib/supabase';
import { ESTAGIOS_MANUAIS } from '@/lib/pipeline-stages';

// Data real de hoje (YYYY-MM-DD).
const TODAY = new Date().toISOString().slice(0, 10);

const STAGES = [
  { id: 'novos_leads', label: 'Novos Leads', color: '#6366f1' },
  { id: 'primeiro_contato', label: 'Primeiro Contato Enviado', color: '#3b82f6' },
  { id: 'aguardando_resposta', label: 'Aguardando Resposta', color: '#f59e0b' },
  { id: 'follow_up', label: 'Follow-up', color: '#ef4444' },
  { id: 'interessado', label: 'Interessado', color: '#8b5cf6' },
  { id: 'reuniao_agendada', label: 'Reunião Agendada', color: '#22c55e' },
] as const;

// Adapta um Lead do Supabase para o shape Empresa usado pelo layout
function leadToEmpresa(lead: Lead): Empresa {
  return {
    id: lead.id,
    nome: lead.empresa,
    segmento: lead.segmento as Empresa['segmento'],
    origem: (lead.origem || 'Automação') as Empresa['origem'],
    cidade: lead.cidade,
    estado: lead.estado,
    website: lead.site ?? undefined,
    responsavel: lead.usuarios?.nome ?? lead.responsavel_nome ?? '',
    status: 'em_prospeccao',
    estagio_pipeline: lead.estagio as Empresa['estagio_pipeline'],
    em_cadencia: false,
    data_entrada: lead.created_at,
    ultimo_contato: lead.ultimo_contato ?? undefined,
    blacklist: false,
    score_engajamento: lead.score,
    observacoes: lead.proxima_acao ?? undefined,
    funcionarios_faixa: lead.faixa_funcionarios ?? undefined,
  };
}

// Cria um Contato sintético a partir dos campos de contato embutidos no Lead
function leadToContato(lead: Lead): Contato {
  const canalMap: Record<Lead['canal_preferencial'], Contato['canal_preferencial']> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    linkedin: 'LinkedIn',
    telefone: 'Telefone',
  };
  return {
    id: `${lead.id}-contato`,
    empresa_id: lead.id,
    nome: lead.contato_nome,
    cargo: lead.contato_cargo,
    canal_preferencial: canalMap[lead.canal_preferencial],
    email: lead.contato_email || undefined,
    telefone: lead.contato_telefone ?? undefined,
    linkedin_url: lead.linkedin ?? undefined,
    principal: true,
    blacklist: false,
  };
}

function daysBetween(a: string, b: string) {
  return Math.floor(
    (new Date(b.substring(0, 10)).getTime() - new Date(a.substring(0, 10)).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

// Rótulo e ícone por tipo de interação vinda do Supabase
const INTERACAO_TIPO: Record<string, { label: string; Icon: typeof Bot; color: string }> = {
  abordagem: { label: 'Abordagem', Icon: User, color: 'text-green-500' },
  resposta: { label: 'Resposta recebida', Icon: MessageSquare, color: 'text-green-400' },
  follow_up: { label: 'Follow-up registrado', Icon: CheckCircle, color: 'text-green-400' },
  nota: { label: 'Nota', Icon: FileText, color: 'text-slate-400' },
  reuniao: { label: 'Reunião', Icon: Bell, color: 'text-purple-500' },
};

// Badge de tipo na Central do Lead (cobre variações de follow_up: follow_up_1/2/3/4)
function getTipoInteracaoBadge(tipo: string, descricao?: string): { label: string; classes: string } {
  if (tipo === 'abordagem') return { label: 'Primeiro contato enviado', classes: 'bg-blue-500/20 text-blue-400' };
  if (tipo.startsWith('follow_up')) return { label: 'Follow-up enviado', classes: 'bg-purple-500/20 text-purple-400' };
  if (tipo === 'resposta') return { label: 'Resposta recebida', classes: 'bg-green-500/20 text-green-400' };
  // Handoff do motor: gravado como tipo='nota' com descrição "Encaminhado ao closer…"
  if (tipo === 'nota' && descricao?.startsWith('Encaminhado ao closer'))
    return { label: 'Encaminhado ao closer', classes: 'bg-amber-500/20 text-amber-400' };
  if (tipo === 'nota') return { label: 'Nota', classes: 'bg-[#252b3b] text-slate-300' };
  if (tipo === 'reuniao') return { label: 'Reunião', classes: 'bg-amber-500/20 text-amber-400' };
  return { label: tipo, classes: 'bg-[#252b3b] text-slate-300' };
}

// "Resposta a tratar": sinais que o MOTOR grava em proxima_acao quando um lead
// responde (aguardando_closer) e quando o closer é avisado (com_closer).
const PROXIMA_ACAO_RESPOSTA = new Set(['aguardando_closer', 'com_closer']);
function temRespostaPendente(lead: Lead | null | undefined): boolean {
  return !!lead?.proxima_acao && PROXIMA_ACAO_RESPOSTA.has(lead.proxima_acao);
}
function respostaPendenteLabel(proximaAcao?: string | null): string {
  return proximaAcao === 'com_closer' ? 'Com o closer' : 'Resposta a tratar';
}

// Badge de status (lado direito) derivado do tipo
function getStatusInteracao(tipo: string): { label: string; classes: string } | null {
  if (tipo === 'abordagem' || tipo.startsWith('follow_up')) return { label: 'Enviado', classes: 'bg-blue-500/10 text-blue-400' };
  if (tipo === 'resposta') return { label: 'Respondido', classes: 'bg-green-500/10 text-green-400' };
  if (tipo === 'reuniao') return { label: 'Agendado', classes: 'bg-amber-500/10 text-amber-400' };
  return null;
}

// Rótulo, ícone e cor do canal (valores em minúsculo no Supabase)
const CANAL_INFO: Record<string, { label: string; Icon: typeof Bot; classes: string }> = {
  email: { label: 'Email', Icon: Mail, classes: 'bg-[#252b3b] text-slate-300' },
  whatsapp: { label: 'WhatsApp', Icon: MessageSquare, classes: 'bg-green-500/20 text-green-400' },
  linkedin: { label: 'LinkedIn', Icon: ExternalLink, classes: 'bg-blue-500/20 text-blue-400' },
  telefone: { label: 'Telefone', Icon: Phone, classes: 'bg-purple-500/20 text-purple-400' },
};

function scoreColor(score: number): string {
  if (score >= 70) return '#16a34a';
  if (score < 50) return '#f97316';
  return '#6b7280';
}

// Painel lateral COMPLETO do lead (slide-over + modal "Central do Lead").
// Dono do próprio estado: carrega o lead por id, as interações reais e executa
// as ações (mover estágio, marcar perdido, executar cadência, registrar nota).
// Compartilhado entre o Pipeline e a Base de Leads — NÃO recriar.
//
// `contexto` decide os controles terminais do rodapé: no Pipeline os estados
// Perdido/Sem resposta não são geridos aqui (vivem só na Base), então some o
// botão "Marcar como perdido" e a opção "Perdido" do seletor de estágio.
export default function LeadPanel({
  leadId,
  onClose,
  onChanged,
  usingSupabase = true,
  contexto = 'base',
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged?: () => void;
  usingSupabase?: boolean;
  contexto?: 'pipeline' | 'base';
}) {
  const selectedId = leadId;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [interacoes, setInteracoes] = useState<Interacao[]>([]);
  const [loadingInteracoes, setLoadingInteracoes] = useState(false);
  const [interacoesError, setInteracoesError] = useState(false);
  const [showAllInteracoes, setShowAllInteracoes] = useState(false);
  const [centralTab, setCentralTab] = useState<'timeline' | 'dados'>('timeline');
  const [showRegistrar, setShowRegistrar] = useState(false);
  const [novaInteracao, setNovaInteracao] = useState({ tipo: 'abordagem', canal: 'email', descricao: '' });
  const [salvandoInteracao, setSalvandoInteracao] = useState(false);
  const [confirmandoPerdido, setConfirmandoPerdido] = useState(false);
  const [executando, setExecutando] = useState(false);
  const [feedbackAcao, setFeedbackAcao] = useState<string | null>(null);
  const [confirmandoLiberar, setConfirmandoLiberar] = useState(false);
  const [liberando, setLiberando] = useState(false);

  // Carrega (ou recarrega) as interações reais do lead selecionado
  const carregarInteracoes = useCallback(async () => {
    if (!selectedId || !usingSupabase) {
      setInteracoes([]);
      setInteracoesError(false);
      return;
    }
    setLoadingInteracoes(true);
    setInteracoesError(false);
    try {
      const data = await getInteracoesByLead(selectedId);
      setInteracoes(data);
    } catch (err) {
      console.error('Erro ao carregar interações:', err);
      setInteracoesError(true);
    } finally {
      setLoadingInteracoes(false);
    }
  }, [selectedId, usingSupabase]);

  // Busca as interações quando o painel abre / troca de lead e reseta a Central
  useEffect(() => {
    setShowAllInteracoes(false);
    setCentralTab('timeline');
    setShowRegistrar(false);
    setConfirmandoPerdido(false);
    setConfirmandoLiberar(false);
    setFeedbackAcao(null);
    setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
    if (selectedId) {
      getLeadById(selectedId).then(setSelectedLead).catch(() => setSelectedLead(null));
    } else {
      setSelectedLead(null);
    }
    carregarInteracoes();
  }, [selectedId, usingSupabase, carregarInteracoes]);

  // Painel lateral — derivado do lead carregado por id.
  const selectedEmpresa: Empresa | null = selectedLead ? leadToEmpresa(selectedLead) : null;
  const selectedContato: Contato | null = selectedLead ? leadToContato(selectedLead) : null;

  // Salva uma nova interação manual e recarrega a timeline
  async function handleRegistrarInteracao() {
    if (!selectedId || !novaInteracao.descricao.trim()) return;
    setSalvandoInteracao(true);
    try {
      await createInteracao({
        lead_id: selectedId,
        tipo: novaInteracao.tipo as Interacao['tipo'],
        canal: novaInteracao.canal,
        descricao: novaInteracao.descricao.trim(),
        origem_acao: 'humano',
      });
      setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' });
      setShowRegistrar(false);
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao registrar interação:', err);
    } finally {
      setSalvandoInteracao(false);
    }
  }

  // Move o lead para outro estágio (movimentação MANUAL do closer), registra a
  // nota e avisa o pai (onChanged) para refazer a lista/board.
  async function handleMoverEstagio(novoEstagio: string) {
    if (!selectedId || !novoEstagio) return;
    try {
      await atualizarEstagio(selectedId, novoEstagio);
      await registrarNota(selectedId, `Estágio alterado manualmente para: ${novoEstagio}`);
      onChanged?.();
      const atualizado = await getLeadById(selectedId).catch(() => null);
      setSelectedLead(atualizado);
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao mover estágio:', err);
      alert('Erro ao mover estágio. Tente novamente.');
    }
  }

  // Marca o lead como perdido (confirmação em dois cliques)
  async function handleMarcarPerdido() {
    if (!selectedId) return;
    if (!confirmandoPerdido) {
      setConfirmandoPerdido(true);
      return;
    }
    try {
      await atualizarEstagio(selectedId, 'perdido');
      await registrarNota(selectedId, 'Lead marcado como perdido manualmente.');
      setConfirmandoPerdido(false);
      onChanged?.();
      onClose();
    } catch (err) {
      console.error('Erro ao marcar como perdido:', err);
      setConfirmandoPerdido(false);
      alert('Erro ao marcar como perdido. Tente novamente.');
    }
  }

  // Libera o lead para o motor (owner n8n → engine). Passo humano DELIBERADO e
  // separado do "Executar ação": com MODO_ENSAIO=false, depois da liberação o
  // motor real pode enviar e-mails automaticamente para este lead. Confirmação
  // em dois cliques (mesmo padrão do "Marcar como perdido"). NÃO dispara a
  // ação em seguida — liberar ≠ mandar agora (ver lib/engine/README.md).
  async function handleLiberarMotor() {
    if (!selectedId) return;
    if (!confirmandoLiberar) {
      setConfirmandoLiberar(true);
      return;
    }
    setLiberando(true);
    setFeedbackAcao(null);
    try {
      await updateLead(selectedId, { owner: 'engine' });
      await registrarNota(selectedId, `Lead liberado para o motor (owner: ${selectedLead?.owner ?? 'n8n'} → engine) manualmente.`);
      const atualizado = await getLeadById(selectedId).catch(() => null);
      setSelectedLead(atualizado);
      setFeedbackAcao('✓ Lead liberado para o motor. "Executar ação" já dispara a próxima etapa.');
      onChanged?.();
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao liberar lead para o motor:', err);
      setFeedbackAcao('✗ Não foi possível liberar o lead para o motor. Tente novamente.');
    } finally {
      setConfirmandoLiberar(false);
      setLiberando(false);
    }
  }

  // Dispara o motor (lib/engine) para executar a próxima etapa da cadência do lead
  async function handleExecutarAcao() {
    if (!selectedId) return;
    setExecutando(true);
    setFeedbackAcao(null);
    try {
      const result = await executarAcao(selectedId);
      setFeedbackAcao(`✓ Ação executada! Estágio: ${result.estagio ?? 'atualizado'}`);
      onChanged?.();
      await carregarInteracoes();
    } catch (err) {
      console.error('Erro ao executar ação:', err);
      const motivo = err instanceof Error ? err.message : null;
      const traducao: Record<string, string> = {
        owner_nao_engine: 'Este lead ainda não foi migrado para o motor (owner != engine).',
        ja_enviado: 'Este contato já foi enviado antes — o motor não reenvia (idempotência).',
        max_followups: 'Este lead já atingiu o máximo de follow-ups.',
        limite_diario: 'Limite diário de envios atingido. Tente novamente amanhã.',
        sem_proximo_estagio: 'Não há próxima etapa a executar para este estágio.',
        perdido: 'Este lead está marcado como perdido.',
        nao_encontrado: 'Lead não encontrado.',
      };
      setFeedbackAcao(`✗ ${motivo && traducao[motivo] ? traducao[motivo] : motivo ?? 'Erro ao executar ação. Tente novamente.'}`);
    } finally {
      setExecutando(false);
    }
  }

  // Sem fonte de dados ou erro no fetch: mostra erro honesto (nunca timeline inventada).
  const historicoIndisponivel = !usingSupabase || interacoesError;

  const panelTimeSince = selectedEmpresa
    ? (selectedEmpresa.ultimo_contato
        ? daysBetween(selectedEmpresa.ultimo_contato, TODAY)
        : daysBetween(selectedEmpresa.data_entrada, TODAY))
    : 0;
  const isActionDelayed = !!selectedEmpresa && panelTimeSince > 5 &&
    (selectedEmpresa.estagio_pipeline === 'aguardando_resposta' ||
     selectedEmpresa.estagio_pipeline === 'follow_up');

  // Lead ainda não liberado para o motor (trava owner != engine): em vez do
  // erro mudo do executarAcao, oferece a liberação como ação explícita.
  const precisaLiberar = usingSupabase && !!selectedLead && selectedLead.owner !== 'engine';

  if (!selectedEmpresa) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 h-full w-96 bg-[#1a1f2e] shadow-2xl z-50 flex flex-col">
        {/* Panel header */}
        <div className="px-5 py-4 border-b border-[#2a3147]">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-start gap-3 flex-1 min-w-0 pr-3">
              <SdrCircle name={selectedEmpresa.responsavel} />
              <div className="min-w-0">
                <h2 className="font-bold text-slate-100 text-lg leading-tight">{selectedEmpresa.nome}</h2>
                {(() => {
                  const partes = [
                    [selectedLead?.cidade ?? selectedEmpresa.cidade, selectedLead?.estado ?? selectedEmpresa.estado].filter(Boolean).join(', '),
                    selectedLead?.segmento ?? selectedEmpresa.segmento,
                    selectedEmpresa.funcionarios_faixa ? `${selectedEmpresa.funcionarios_faixa} func.` : '',
                  ].filter(Boolean)
                  return partes.length > 0 ? (
                    <div className="text-sm text-slate-400 mt-0.5">{partes.join(' · ')}</div>
                  ) : null
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="text-slate-600 hover:text-amber-400 transition-colors"><Star size={16} /></button>
              <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors"><X size={18} /></button>
            </div>
          </div>
          {selectedContato ? (
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <span className="text-sm font-semibold text-slate-200 truncate">{selectedContato.nome}</span>
              {selectedContato.cargo && (
                <>
                  <span className="text-slate-600 text-xs shrink-0">|</span>
                  <span className="text-xs text-slate-400 truncate">{selectedContato.cargo}</span>
                </>
              )}
              {selectedContato.canal_preferencial && (
                <>
                  <span className="text-slate-600 text-xs shrink-0">|</span>
                  <span className="text-xs text-slate-300 shrink-0">{selectedContato.canal_preferencial}</span>
                </>
              )}
              <div className="flex items-center gap-2 ml-auto shrink-0 text-slate-500">
                {selectedContato.email && (
                  <a href={`mailto:${selectedContato.email}`} className="hover:text-blue-400 transition-colors" title={selectedContato.email}><Mail size={13} /></a>
                )}
                {selectedContato.telefone && (
                  <a href={`tel:${selectedContato.telefone}`} className="hover:text-green-400 transition-colors" title={selectedContato.telefone}><Phone size={13} /></a>
                )}
                {selectedContato.canal_preferencial === 'WhatsApp' && selectedContato.telefone && (
                  <a href={`https://wa.me/${selectedContato.telefone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                    className="hover:text-green-500 transition-colors" title="WhatsApp"><MessageSquare size={13} /></a>
                )}
                {selectedContato.linkedin_url && (
                  <a href={`https://${selectedContato.linkedin_url}`} target="_blank" rel="noopener noreferrer"
                    className="hover:text-blue-400 transition-colors" title="LinkedIn"><ExternalLink size={13} /></a>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-slate-500">
              {selectedEmpresa.website && (
                <a href={selectedEmpresa.website} target="_blank" rel="noopener noreferrer"
                  className="hover:text-blue-400 transition-colors" title="Site"><ExternalLink size={13} /></a>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Status */}
          <div className="px-5 py-3 border-b border-[#2a3147] flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusBadgeClasses(selectedEmpresa.status)}`}>
              {getStatusLabel(selectedEmpresa.status)}
            </span>
            {temRespostaPendente(selectedLead) && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-300">
                <MessageSquare size={11} /> {respostaPendenteLabel(selectedLead?.proxima_acao)}
              </span>
            )}
            {selectedEmpresa.em_cadencia && (
              <span className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-full">
                Cadência ativa
              </span>
            )}
            <div className="ml-auto">
              <SdrPill name={selectedEmpresa.responsavel} />
            </div>
          </div>

          {/* 4 KPI cards */}
          <div className="px-4 py-3 border-b border-[#2a3147] grid grid-cols-2 gap-2">
            {[
              {
                label: 'Último contato',
                value: `${panelTimeSince}d`,
                sub: panelTimeSince === 0 ? 'hoje' : 'atrás',
                color: panelTimeSince > 7 ? '#ef4444' : '#374151',
              },
              {
                label: 'Score',
                value: String(selectedEmpresa.score_engajamento),
                sub: '/ 100',
                color: selectedEmpresa.score_engajamento >= 70 ? '#16a34a' : selectedEmpresa.score_engajamento >= 40 ? '#d97706' : '#ef4444',
              },
              {
                label: 'Estágio',
                value: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.label ?? selectedEmpresa.estagio_pipeline,
                sub: '',
                color: STAGES.find(s => s.id === selectedEmpresa.estagio_pipeline)?.color ?? '#374151',
              },
              {
                label: 'Canal preferencial',
                value: selectedContato?.canal_preferencial ?? '—',
                sub: '',
                color: '#374151',
              },
            ].map(card => (
              <div key={card.label} className="bg-[#0f1117] rounded-xl px-3 py-2" style={{ maxHeight: 80 }}>
                <div className="text-xs text-slate-500 mb-1 leading-none">{card.label}</div>
                <div className="font-bold text-sm leading-tight truncate" style={{ color: card.color }}>{card.value}</div>
                {card.sub && <div className="text-xs text-slate-500 mt-0.5">{card.sub}</div>}
              </div>
            ))}
          </div>

          {/* Próxima ação IA */}
          <div className="px-5 py-3 border-b border-[#2a3147]">
            <div className="flex items-center gap-1.5 mb-2">
              <Bot size={12} className="text-indigo-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Próxima ação · IA</span>
              {isActionDelayed && (
                <span className="ml-auto text-xs font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">Atrasada</span>
              )}
            </div>
            <button
              type="button"
              onClick={precisaLiberar ? handleLiberarMotor : handleExecutarAcao}
              disabled={executando || liberando}
              title={precisaLiberar ? 'Liberar este lead para o motor de cadência' : 'Executar próxima etapa da cadência'}
              className={`w-full text-left rounded-xl px-3 py-2 mb-2 transition-colors disabled:opacity-60 ${isActionDelayed ? 'bg-red-500/10 hover:bg-red-500/20' : 'bg-indigo-500/10 hover:bg-indigo-500/20'}`}
            >
              <p className={`text-sm font-semibold leading-snug ${isActionDelayed ? 'text-red-900' : 'text-indigo-900'}`}>
                {selectedEmpresa.observacoes ?? 'Executar próxima etapa da cadência'}
              </p>
            </button>
            <button className="w-full text-xs font-medium text-slate-300 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#0f1117] transition-colors mb-2">
              Registrar ação
            </button>
            <div className="flex gap-2">
              {precisaLiberar ? (
                /* Trava n8n→motor: liberar é um passo humano separado do
                   "Executar ação" — depois disso o motor REAL pode enviar
                   e-mails automaticamente (MODO_ENSAIO=false). */
                <button
                  onClick={handleLiberarMotor}
                  disabled={liberando}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                    confirmandoLiberar
                      ? 'text-black bg-amber-400 hover:bg-amber-300'
                      : 'text-amber-300 bg-amber-500/15 border border-amber-500/40 hover:bg-amber-500/25'
                  }`}
                >
                  {liberando ? 'Liberando...' : confirmandoLiberar ? 'Confirmar liberação?' : 'Liberar para o motor'}
                </button>
              ) : (
                <button
                  onClick={handleExecutarAcao}
                  disabled={executando}
                  className="flex-1 text-xs font-semibold text-white py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#6366f1' }}
                >
                  {executando ? 'Executando...' : 'Executar ação'}
                </button>
              )}
              <button className="flex-1 text-xs font-medium text-slate-300 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#0f1117] transition-colors">
                Gerar mensagem
              </button>
            </div>
            {confirmandoLiberar && !liberando && (
              <p className="text-[11px] text-amber-400 mt-2 leading-snug">
                Isso entrega o lead ao motor REAL: a partir da liberação, os e-mails da
                cadência são enviados de verdade (automaticamente e via “Executar ação”).
                Clique de novo para confirmar.
              </p>
            )}
            {feedbackAcao && (
              <p className={`text-xs mt-2 ${feedbackAcao.startsWith('✓') ? 'text-green-400' : 'text-red-500'}`}>
                {feedbackAcao}
              </p>
            )}
          </div>

          {/* Resumo IA */}
          <div className="px-5 py-3 border-b border-[#2a3147]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Bot size={12} className="text-green-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Resumo · IA</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
              {selectedEmpresa.observacoes ?? 'Sem resumo disponível.'}
            </p>
          </div>

          {/* Registrar interação */}
          <div className="px-5 py-3 border-b border-[#2a3147]">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Registrar interação</span>
            <div className="flex gap-2">
              {(['Abordagem', 'Resposta', 'Follow-up'] as const).map(tipo => (
                <button
                  key={tipo}
                  className="flex-1 text-xs font-medium text-slate-300 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#0f1117] transition-colors"
                >
                  {tipo}
                </button>
              ))}
            </div>
          </div>

          {/* Histórico */}
          <div className="px-5 py-4 border-b border-[#2a3147]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Histórico de interações</span>
              <button
                type="button"
                onClick={() => setShowAllInteracoes(true)}
                className="text-xs text-indigo-400 hover:underline flex items-center gap-0.5"
              >
                Ver tudo <ArrowRight size={10} />
              </button>
            </div>
            {historicoIndisponivel ? (
              <p className="text-xs text-red-400">Não foi possível carregar o histórico. Tente novamente.</p>
            ) : loadingInteracoes ? (
              <div className="flex items-center gap-2 text-slate-500 py-2">
                <Loader2 size={13} className="animate-spin" />
                <span className="text-xs">Carregando interações...</span>
              </div>
            ) : interacoes.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma interação registrada ainda.</p>
            ) : (
              <div className="space-y-2.5">
                {interacoes.map(interacao => {
                  const cfg = INTERACAO_TIPO[interacao.tipo] ?? INTERACAO_TIPO.nota;
                  const isIA = interacao.origem_acao === 'ia';
                  const Icon = isIA ? Bot : cfg.Icon;
                  return (
                    <div key={interacao.id} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-full bg-[#252b3b] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={10} className={isIA ? 'text-blue-500' : cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-300">
                          {interacao.descricao || cfg.label}
                          {interacao.canal && (
                            <span className="text-slate-500"> · {interacao.canal}</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {new Date(interacao.created_at).toLocaleDateString('pt-BR')}
                          <span className="ml-1.5">{isIA ? '· IA' : '· Manual'}</span>
                          {interacao.usuarios?.nome && (
                            <span className="ml-1.5">· {interacao.usuarios.nome}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Informações completas — esconde campos vazios */}
          {(() => {
            type Linha = { label: string; value?: string | null; href?: string; link?: boolean; cap?: boolean };
            const L = selectedLead;
            const cidadeEstado = [L?.cidade ?? selectedEmpresa.cidade, L?.estado ?? selectedEmpresa.estado]
              .filter(Boolean).join(', ');
            const siteRaw = L?.site ?? selectedEmpresa.website;
            const site = siteRaw ? (siteRaw.startsWith('http') ? siteRaw : `https://${siteRaw}`) : null;
            const linkedin = L?.linkedin ? (L.linkedin.startsWith('http') ? L.linkedin : `https://${L.linkedin}`) : null;
            const score = L?.score ?? selectedEmpresa.score_engajamento;
            const criado = L?.created_at ?? selectedEmpresa.data_entrada;

            const contato: Linha[] = [
              { label: 'Contato', value: L?.contato_nome ?? selectedContato?.nome },
              { label: 'Cargo', value: L?.contato_cargo ?? selectedContato?.cargo },
              { label: 'E-mail', value: L?.contato_email ?? selectedContato?.email, href: 'mailto:' },
              { label: 'Telefone', value: L?.contato_telefone ?? selectedContato?.telefone, href: 'tel:' },
              { label: 'Canal preferencial', value: L?.canal_preferencial ?? selectedContato?.canal_preferencial, cap: true },
            ];
            const empresa: Linha[] = [
              { label: 'Segmento / nicho', value: L?.segmento ?? selectedEmpresa.segmento },
              { label: 'Cidade', value: cidadeEstado },
              { label: 'Funcionários', value: L?.faixa_funcionarios ?? selectedEmpresa.funcionarios_faixa },
              { label: 'Responsável', value: L?.usuarios?.nome ?? selectedEmpresa.responsavel },
              { label: 'Origem', value: L?.origem ?? selectedEmpresa.origem },
              { label: 'Score', value: score ? `${score} / 100` : null },
              { label: 'Criado em', value: criado ? formatDate(criado) : null },
              { label: 'Site', value: site, link: true },
              { label: 'LinkedIn', value: linkedin, link: true },
            ];
            const render = (linhas: Linha[]) =>
              linhas.filter(l => l.value).map(l => {
                const v = l.value as string;
                return (
                  <div key={l.label} className="flex justify-between gap-3">
                    <span className="text-slate-400 shrink-0">{l.label}</span>
                    {l.href ? (
                      <a href={`${l.href}${v}`} className="text-indigo-400 hover:underline text-xs truncate max-w-44">{v}</a>
                    ) : l.link ? (
                      <a href={v} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline text-xs truncate max-w-44">{v}</a>
                    ) : (
                      <span className={`font-medium text-slate-300 text-right truncate max-w-44 ${l.cap ? 'capitalize' : ''}`}>{v}</span>
                    )}
                  </div>
                );
              });

            return (
              <div className="px-5 py-4 space-y-4">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">Dados do contato</span>
                  <div className="space-y-1.5 text-sm">{render(contato)}</div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">Informações da empresa</span>
                  <div className="space-y-1.5 text-sm">{render(empresa)}</div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#2a3147] flex items-center gap-2.5 bg-[#0f1117]">
          <select
            value={selectedLead?.estagio ?? selectedEmpresa.estagio_pipeline ?? ''}
            onChange={(e) => handleMoverEstagio(e.target.value)}
            className="flex-1 text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none"
          >
            <option value="" disabled>Mover para outro estágio</option>
            {ESTAGIOS_MANUAIS
              .filter(s => contexto !== 'pipeline' || s.value !== 'perdido')
              .map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
          </select>
          {contexto !== 'pipeline' && (
            <button
              onClick={handleMarcarPerdido}
              onBlur={() => setConfirmandoPerdido(false)}
              className={`text-sm font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                confirmandoPerdido
                  ? 'bg-red-600 text-white hover:bg-red-700 border border-red-600'
                  : 'text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20'
              }`}
            >
              {confirmandoPerdido ? 'Confirmar perda?' : 'Marcar como perdido'}
            </button>
          )}
        </div>
      </div>

      {/* Central do Lead — modal completo */}
      {showAllInteracoes && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowAllInteracoes(false)}
        >
          <div
            className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* HEADER */}
            <div className="px-6 py-5 border-b border-[#2a3147]">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-100 leading-tight">{selectedEmpresa.nome}</h2>
                  <div className="text-sm text-slate-400 mt-0.5">
                    {selectedEmpresa.cidade}, {selectedEmpresa.estado} · {selectedEmpresa.segmento}
                  </div>
                  {selectedContato && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-300 mt-1">
                      <span className="font-semibold text-slate-200">{selectedContato.nome}</span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{selectedContato.cargo}</span>
                      <span className="text-slate-600">·</span>
                      {(() => {
                        const ci = selectedLead ? CANAL_INFO[selectedLead.canal_preferencial] : null;
                        const Icon = ci?.Icon ?? Mail;
                        return (
                          <span className="inline-flex items-center gap-1 text-slate-300">
                            <Icon size={13} /> {selectedContato.canal_preferencial}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowAllInteracoes(false)}
                  className="text-slate-500 hover:text-slate-300 transition-colors shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Row de badges informativos */}
              <div className="flex flex-wrap gap-2 mt-4">
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Responsável</span>
                  <span className="text-sm font-medium text-slate-300">{selectedEmpresa.responsavel || '—'}</span>
                </div>
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Status</span>
                  <span className="text-sm font-medium text-slate-300">{getEstagioPipelineLabel(selectedEmpresa.estagio_pipeline as EstagioPipeline)}</span>
                </div>
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Último contato</span>
                  <span className="text-sm font-medium text-slate-300">{selectedLead?.ultimo_contato ? formatDate(selectedLead.ultimo_contato) : '—'}</span>
                </div>
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147] max-w-xs">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Próxima ação</span>
                  <span className="text-sm font-medium text-slate-300 truncate">{selectedLead?.proxima_acao || '—'}</span>
                </div>
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Canal preferencial</span>
                  <span className="text-sm font-medium text-slate-300 capitalize">{selectedLead?.canal_preferencial ?? selectedContato?.canal_preferencial ?? '—'}</span>
                </div>
                <div className="flex flex-col bg-[#0f1117] rounded-lg px-3 py-1.5 border border-[#2a3147]">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Score</span>
                  <span className="text-sm font-bold" style={{ color: scoreColor(selectedLead?.score ?? selectedEmpresa.score_engajamento) }}>
                    {selectedLead?.score ?? selectedEmpresa.score_engajamento} <span className="text-slate-500 font-normal">/ 100</span>
                  </span>
                </div>
              </div>
            </div>

            {/* TABS */}
            <div className="px-6 border-b border-[#2a3147] flex gap-1">
              {([
                { id: 'timeline', label: 'Linha do tempo' },
                { id: 'dados', label: 'Dados do lead' },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCentralTab(tab.id)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    centralTab === tab.id
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* CONTEÚDO */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {centralTab === 'timeline' ? (
                <div>
                  {/* Botão registrar */}
                  <div className="mb-4">
                    <button
                      onClick={() => setShowRegistrar(v => !v)}
                      className="flex items-center gap-1.5 text-sm font-medium text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Plus size={14} /> Registrar interação
                    </button>

                    {showRegistrar && (
                      <div className="mt-3 p-4 rounded-xl border border-[#2a3147] bg-[#0f1117] space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Tipo</label>
                            <select
                              value={novaInteracao.tipo}
                              onChange={e => setNovaInteracao(s => ({ ...s, tipo: e.target.value }))}
                              className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                            >
                              <option value="abordagem">Abordagem</option>
                              <option value="follow_up">Follow-up</option>
                              <option value="resposta">Resposta</option>
                              <option value="nota">Nota</option>
                              <option value="reuniao">Reunião</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Canal</label>
                            <select
                              value={novaInteracao.canal}
                              onChange={e => setNovaInteracao(s => ({ ...s, canal: e.target.value }))}
                              className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                            >
                              <option value="email">Email</option>
                              <option value="whatsapp">WhatsApp</option>
                              <option value="linkedin">LinkedIn</option>
                              <option value="telefone">Telefone</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-400 block mb-1">Descrição</label>
                          <textarea
                            value={novaInteracao.descricao}
                            onChange={e => setNovaInteracao(s => ({ ...s, descricao: e.target.value }))}
                            rows={3}
                            placeholder="Descreva a interação..."
                            className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => { setShowRegistrar(false); setNovaInteracao({ tipo: 'abordagem', canal: 'email', descricao: '' }); }}
                            className="text-sm font-medium text-slate-300 px-3 py-1.5 rounded-lg border border-[#2a3147] hover:bg-[#252b3b] transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleRegistrarInteracao}
                            disabled={salvandoInteracao || !novaInteracao.descricao.trim()}
                            className="flex items-center gap-1.5 text-sm font-semibold text-white px-4 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                            style={{ backgroundColor: '#6366f1' }}
                          >
                            {salvandoInteracao && <Loader2 size={13} className="animate-spin" />}
                            Salvar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Lista da timeline */}
                  {loadingInteracoes ? (
                    <div className="flex items-center gap-2 text-slate-500 py-6">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Carregando interações...</span>
                    </div>
                  ) : interacoes.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4">Nenhuma interação registrada ainda.</p>
                  ) : (
                    <div className="space-y-3">
                      {interacoes.map(interacao => {
                        const tipoBadge = getTipoInteracaoBadge(interacao.tipo, interacao.descricao);
                        const statusBadge = getStatusInteracao(interacao.tipo);
                        const canal = interacao.canal ? CANAL_INFO[interacao.canal.toLowerCase()] : null;
                        const isIA = interacao.origem_acao === 'ia';
                        return (
                          <div key={interacao.id} className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-4 shadow-none">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                  <Clock size={11} /> {formatDateTime(interacao.created_at)}
                                </span>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipoBadge.classes}`}>
                                  {tipoBadge.label}
                                </span>
                                {canal && (
                                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${canal.classes}`}>
                                    <canal.Icon size={11} /> {canal.label}
                                  </span>
                                )}
                                {isIA && (
                                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">IA</span>
                                )}
                              </div>
                              {statusBadge && (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusBadge.classes}`}>
                                  {statusBadge.label}
                                </span>
                              )}
                            </div>
                            {interacao.descricao && (
                              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{interacao.descricao}</p>
                            )}
                            {interacao.usuarios?.nome && (
                              <p className="text-xs text-slate-500 mt-1.5">por {interacao.usuarios.nome}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ABA DADOS DO LEAD */
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {[
                    { label: 'Empresa', value: selectedLead?.empresa ?? selectedEmpresa.nome },
                    { label: 'Cidade', value: selectedLead?.cidade ?? selectedEmpresa.cidade },
                    { label: 'Estado', value: selectedLead?.estado ?? selectedEmpresa.estado },
                    { label: 'Segmento', value: selectedLead?.segmento ?? selectedEmpresa.segmento },
                    { label: 'Site', value: selectedLead?.site, isLink: true },
                    { label: 'LinkedIn', value: selectedLead?.linkedin, isLink: true },
                    { label: 'Contato Nome', value: selectedLead?.contato_nome ?? selectedContato?.nome },
                    { label: 'Contato Cargo', value: selectedLead?.contato_cargo ?? selectedContato?.cargo },
                    { label: 'Contato Email', value: selectedLead?.contato_email ?? selectedContato?.email },
                    { label: 'Contato Telefone', value: selectedLead?.contato_telefone ?? selectedContato?.telefone },
                    { label: 'Canal Preferencial', value: selectedLead?.canal_preferencial, capitalize: true },
                    { label: 'Origem', value: selectedLead?.origem ?? selectedEmpresa.origem },
                    { label: 'Score', value: selectedLead ? `${selectedLead.score} / 100` : `${selectedEmpresa.score_engajamento} / 100` },
                    { label: 'Criado em', value: selectedLead?.created_at ? formatDate(selectedLead.created_at) : formatDate(selectedEmpresa.data_entrada) },
                  ].map(field => (
                    <div key={field.label} className="border-b border-[#2a3147] pb-2">
                      <span className="text-xs text-slate-500 uppercase tracking-wide block mb-0.5">{field.label}</span>
                      {field.value ? (
                        field.isLink ? (
                          <a
                            href={field.value.startsWith('http') ? field.value : `https://${field.value}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-indigo-400 hover:underline break-all"
                          >
                            {field.value}
                          </a>
                        ) : (
                          <span className={`text-sm font-medium text-slate-300 ${field.capitalize ? 'capitalize' : ''}`}>{field.value}</span>
                        )
                      ) : (
                        <span className="text-sm text-slate-600">—</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
