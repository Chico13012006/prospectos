'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Database } from 'lucide-react';
import { formatDate, dash } from '@/lib/utils';
import { labelEstagio } from '@/lib/pipeline-stages';
import { getTodosLeads, getPipelineFiltrosOpcoes, type BaseLeadsFiltros } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import LeadPanel from '@/components/leads/LeadPanel';
import FiltrosBase, { FILTRO_VAZIO, type BaseFiltroForm } from '@/components/base/FiltrosBase';
import { EstadoTabela, PaginacaoTabela } from '@/components/ui/tabela';

const PAGE = 50;

// Etapa de follow-up (cache followups_enviados) → rótulo curto.
function etapaFollowup(n?: number): string {
  if (!n) return '—';
  return n >= 4 ? '4º+' : `${n}º`;
}

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

  // Debounce só do FORM (campos digitados: busca, cidade, estado…); cliques de
  // página e o reload pós-mutação disparam o fetch imediatamente.
  const [formDebounced, setFormDebounced] = useState(form);
  useEffect(() => {
    const t = setTimeout(() => setFormDebounced(form), 250);
    return () => clearTimeout(t);
  }, [form]);

  // Form (strings) → filtros server-side da query.
  const filtros: BaseLeadsFiltros = useMemo(() => ({
    busca: formDebounced.busca || undefined,
    responsavel: formDebounced.responsavel || undefined,
    segmento: formDebounced.segmento || undefined,
    estagio: formDebounced.estagio || undefined,
    followups: formDebounced.followup === '1' ? 1 : formDebounced.followup === '2' ? 2 : formDebounced.followup === '3' ? 3 : formDebounced.followup === '4+' ? { gte: 4 } : undefined,
    cidade: formDebounced.cidade || undefined,
    estado: formDebounced.estado || undefined,
    cadastroDe: formDebounced.cadastroDe ? `${formDebounced.cadastroDe}T00:00:00` : null,
    cadastroAte: formDebounced.cadastroAte ? `${formDebounced.cadastroAte}T23:59:59.999` : null,
    interacaoDe: formDebounced.interacaoDe ? `${formDebounced.interacaoDe}T00:00:00` : null,
    interacaoAte: formDebounced.interacaoAte ? `${formDebounced.interacaoAte}T23:59:59.999` : null,
    atalho: formDebounced.atalho || undefined,
  }), [formDebounced]);

  // Troca de filtro volta para a primeira página.
  useEffect(() => { setPage(0); }, [filtros]);

  // Nº de sequência do fetch: resposta antiga em voo não sobrescreve a nova.
  const seqRef = useRef(0);

  const carregar = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    const { data, total } = await getTodosLeads(filtros, { limit: PAGE, offset: page * PAGE });
    if (seq !== seqRef.current) return;
    setData(data);
    setTotal(total);
    setLoading(false);
    // Mutação pode encolher o total com a página além do fim: volta pra última válida.
    const ultimaPagina = Math.max(0, Math.ceil(total / PAGE) - 1);
    if (page > ultimaPagina) setPage(ultimaPagina);
  }, [filtros, page]);

  useEffect(() => { carregar(); }, [carregar, reloadKey]);

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
              {data.length === 0 ? (
                <EstadoTabela colSpan={8} loading={loading} />
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

      <PaginacaoTabela
        total={total}
        page={page}
        pageSize={PAGE}
        loading={loading}
        onPageChange={setPage}
        className="px-6 py-3 shrink-0 border-t border-[#2a3147] bg-[#0f1117]"
      />

      {/* Painel lateral completo (componente compartilhado em components/leads) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        usingSupabase={!useFallback}
        contexto="base"
      />
    </div>
  );
}
