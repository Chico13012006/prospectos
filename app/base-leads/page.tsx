'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Database } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { labelEstagio } from '@/lib/pipeline-stages';
import { getTodosLeads, getPipelineFiltrosOpcoes, type BaseLeadsFiltros } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import LeadPanel from '@/components/pipeline/LeadPanel';
import FiltrosBase, { FILTRO_VAZIO, type BaseFiltroForm } from '@/components/base/FiltrosBase';

const PAGE = 50;

// Etapa de follow-up (cache followups_enviados) → rótulo curto.
function etapaFollowup(n?: number): string {
  if (!n) return '—';
  return n >= 4 ? '4º+' : `${n}º`;
}

const dash = (v?: string | null) => (v && String(v).trim() ? String(v) : '—');

export default function BaseLeadsPage() {
  const [form, setForm] = useState<BaseFiltroForm>(FILTRO_VAZIO);
  const [filtroOpcoes, setFiltroOpcoes] = useState<{ responsaveis: string[]; segmentos: string[]; canais: string[] }>({ responsaveis: [], segmentos: [], canais: [] });
  const [data, setData] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Opções dos selects + sonda de conexão.
  useEffect(() => {
    getPipelineFiltrosOpcoes()
      .then(setFiltroOpcoes)
      .catch(err => { console.error('Erro ao carregar Base de Leads:', err); setUseFallback(true); });
  }, []);

  // Form (strings) → filtros server-side da query.
  const filtros: BaseLeadsFiltros = useMemo(() => ({
    busca: form.busca || undefined,
    responsavel: form.responsavel || undefined,
    segmento: form.segmento || undefined,
    estagio: form.estagio || undefined,
    followups: form.followup === '1' ? 1 : form.followup === '2' ? 2 : form.followup === '3' ? 3 : form.followup === '4+' ? { gte: 4 } : undefined,
    cidade: form.cidade || undefined,
    estado: form.estado || undefined,
    cadastroDe: form.cadastroDe ? `${form.cadastroDe}T00:00:00` : null,
    cadastroAte: form.cadastroAte ? `${form.cadastroAte}T23:59:59.999` : null,
    interacaoDe: form.interacaoDe ? `${form.interacaoDe}T00:00:00` : null,
    interacaoAte: form.interacaoAte ? `${form.interacaoAte}T23:59:59.999` : null,
    atalho: form.atalho || undefined,
  }), [form]);

  // Troca de filtro volta para a primeira página.
  useEffect(() => { setPage(0); }, [filtros]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, total } = await getTodosLeads(filtros, { limit: PAGE, offset: page * PAGE });
    setData(data);
    setTotal(total);
    setLoading(false);
  }, [filtros, page]);

  // Debounce: muda filtro/página (ou após mutação no painel) → refaz o fetch.
  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [carregar, reloadKey]);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE));
  const inicio = total === 0 ? 0 : page * PAGE + 1;
  const fim = Math.min((page + 1) * PAGE, total);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Database size={22} className="text-indigo-400" /> Base de Leads
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">Banco geral — todos os leads, em qualquer estado.</p>
      </div>

      {/* Filtros */}
      <div className="px-6 pb-3 shrink-0">
        <FiltrosBase
          value={form}
          onChange={setForm}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
        />
      </div>

      {/* Tabela */}
      <div className="flex-1 min-h-0 px-6 pb-2 overflow-auto">
        {useFallback ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
            <span className="text-xs">Verifique a conexão com o Supabase.</span>
          </div>
        ) : (
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-[#0f1117]">
                {['Empresa', 'Contato', 'Responsável', 'Status', 'Follow-up', 'Cidade/UF', 'Última interação', 'Cadastrado em'].map(h => (
                  <th key={h} className="font-semibold px-3 py-2.5 border-b border-[#2a3147] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && data.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-500">
                  <Loader2 size={18} className="animate-spin inline mr-2" /> Carregando...
                </td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-500 text-sm">Nenhum lead encontrado com esses filtros.</td></tr>
              ) : (
                data.map(lead => {
                  const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null;
                  const cidadeUf = [lead.cidade, lead.estado].filter(Boolean).join('/');
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(lead.id)}
                      className={`cursor-pointer transition-colors ${selectedId === lead.id ? 'bg-indigo-500/10' : 'hover:bg-[#1a1f2e]'}`}
                    >
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 font-medium text-slate-100 max-w-56 truncate">{dash(lead.empresa)}</td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 max-w-56">
                        <div className="text-slate-300 truncate">{dash(lead.contato_nome)}</div>
                        {lead.contato_email && <div className="text-xs text-slate-500 truncate">{lead.contato_email}</div>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{dash(responsavel)}</td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 whitespace-nowrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[#252b3b] text-slate-300">{labelEstagio(lead.estagio)}</span>
                      </td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{etapaFollowup(lead.followups_enviados)}</td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{dash(cidadeUf)}</td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-400 whitespace-nowrap">{lead.ultimo_contato ? formatDate(lead.ultimo_contato) : '—'}</td>
                      <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-400 whitespace-nowrap">{lead.created_at ? formatDate(lead.created_at) : '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginação */}
      <div className="px-6 py-3 shrink-0 border-t border-[#2a3147] flex items-center justify-between bg-[#0f1117]">
        <span className="text-xs text-slate-500">
          {total > 0 ? `${inicio.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}` : '0 leads'}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Página {page + 1} de {totalPaginas}</span>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="flex items-center gap-1 text-xs text-slate-300 border border-[#2a3147] px-2.5 py-1.5 rounded-lg hover:bg-[#1a1f2e] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <button
            onClick={() => setPage(p => (p + 1 < totalPaginas ? p + 1 : p))}
            disabled={page + 1 >= totalPaginas || loading}
            className="flex items-center gap-1 text-xs text-slate-300 border border-[#2a3147] px-2.5 py-1.5 rounded-lg hover:bg-[#1a1f2e] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Próxima <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Painel lateral completo (REUSO do componente do Pipeline) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        usingSupabase={!useFallback}
      />
    </div>
  );
}
