'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Database, Plus, FileSpreadsheet } from 'lucide-react';
import { formatDate, dash } from '@/lib/utils';
import { labelEstagio, corEstagio } from '@/lib/pipeline-stages';
import { getTodosLeads, getPipelineFiltrosOpcoes, type BaseLeadsFiltros } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import LeadPanel from '@/components/leads/LeadPanel';
import NovoLeadModal from '@/components/leads/NovoLeadModal';
import ImportarLeadsModal from '@/components/leads/ImportarLeadsModal';
import FiltrosBase, { FILTRO_VAZIO, type BaseFiltroForm } from '@/components/base/FiltrosBase';
import { EstadoTabela, PaginacaoTabela } from '@/components/ui/tabela';

const PAGE = 50;

// Limites do filtro de data (item 4). Colunas são timestamptz (UTC) e o display
// mostra a data-calendário UTC — então os limites são UTC pra bater com a tela.
// Início do dia (inclusivo) e início do PRÓXIMO dia (exclusivo → usado com `.lt`,
// cobre o dia inteiro sem depender de "23:59:59.999").
function inicioDiaUTC(dia: string): string {
  return `${dia}T00:00:00.000Z`;
}
function fimExclusivoUTC(dia: string): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// Etapa de follow-up (cache followups_enviados) → rótulo curto.
function etapaFollowup(n?: number): string {
  if (!n) return '—';
  return n >= 4 ? '4º+' : `${n}º`;
}

// Cor do score (0-100): frio (baixo) → quente (alto). Score alto = respondeu rápido.
function corScore(score?: number): string {
  const s = score ?? 0;
  if (s >= 85) return '#22c55e';
  if (s >= 65) return '#eab308';
  return '#64748b';
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
  const [modal, setModal] = useState<null | 'novo' | 'importar'>(null);
  // Ordenação da tabela (item 2.8): clique no cabeçalho "Score" ordena por score.
  const [ordenarPor, setOrdenarPor] = useState<{ campo: 'score'; asc: boolean } | null>(null);

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
    // Datas de cadastro/interação: intervalo MEIO-ABERTO [início, fim+1dia). As
    // colunas são timestamptz (UTC) e o display (formatDate) mostra a data-
    // calendário UTC — então os limites também são UTC, pra display e filtro
    // baterem. O fim é o PRÓXIMO dia (exclusivo, `.lt` na query): garante o dia
    // inteiro sem perder registro por horário/borda (item 4). Ver getTodosLeads.
    cadastroDe: formDebounced.cadastroDe ? inicioDiaUTC(formDebounced.cadastroDe) : null,
    cadastroAte: formDebounced.cadastroAte ? fimExclusivoUTC(formDebounced.cadastroAte) : null,
    interacaoDe: formDebounced.interacaoDe ? inicioDiaUTC(formDebounced.interacaoDe) : null,
    interacaoAte: formDebounced.interacaoAte ? fimExclusivoUTC(formDebounced.interacaoAte) : null,
    atalho: formDebounced.atalho || undefined,
    ordenarPor: ordenarPor ?? undefined,
  }), [formDebounced, ordenarPor]);

  // Alterna a ordenação por score: 1º clique = maior→menor, 2º = menor→maior, 3º = limpa.
  const toggleOrdenarScore = useCallback(() => {
    setOrdenarPor(prev => (prev == null ? { campo: 'score', asc: false } : prev.asc ? null : { campo: 'score', asc: true }));
  }, []);

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
      <div className="px-6 pt-6 pb-3 shrink-0 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Database size={22} className="text-indigo-400" /> Base de Leads
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Banco geral — todos os leads, em qualquer estado.</p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setModal('importar')}
              className="flex items-center gap-2 text-sm text-slate-300 border border-[#2a3147] px-3 py-2 rounded-lg hover:bg-[#0f1117]"
            >
              <FileSpreadsheet size={14} /> Importar leads
            </button>
            <button
              onClick={() => setModal('novo')}
              className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
              style={{ backgroundColor: '#1e3a5f' }}
            >
              <Plus size={14} /> Novo lead
            </button>
          </div>
          {!useFallback && (
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-100 leading-none tabular-nums">{total.toLocaleString('pt-BR')}</div>
              <div className="text-xs text-slate-500 mt-1">
                {total === 1 ? 'lead' : 'leads'}{loading ? '…' : ''}
              </div>
            </div>
          )}
        </div>
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
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-[var(--bg-base)]">
                {['Empresa', 'Contato', 'Responsável', 'Status', 'Follow-up'].map(h => (
                  <th key={h} className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">{h}</th>
                ))}
                <th className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">
                  <button
                    onClick={toggleOrdenarScore}
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-300 transition-colors focus-ring rounded"
                    title="Ordenar por score"
                  >
                    Score {ordenarPor ? (ordenarPor.asc ? '↑' : '↓') : '↕'}
                  </button>
                </th>
                {['Cidade/UF', 'Última interação', 'Cadastrado em'].map(h => (
                  <th key={h} className="font-semibold px-3 py-2.5 border-b border-[var(--border)] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EstadoTabela colSpan={9} loading={loading} />
              ) : (
                data.map(lead => {
                  const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null;
                  const cidadeUf = [lead.cidade, lead.estado].filter(Boolean).join('/');
                  const selecionado = selectedId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(lead.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(lead.id); } }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Abrir ${lead.empresa ?? 'lead'}`}
                      className={`cursor-pointer transition-colors focus-ring ${selecionado ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-card)]'}`}
                    >
                      <td className={`px-3 py-2.5 border-b border-[var(--border-subtle)] font-medium text-slate-100 max-w-56 truncate ${selecionado ? 'border-l-2 border-l-[var(--accent)]' : 'border-l-2 border-l-transparent'}`}>{dash(lead.empresa)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] max-w-56">
                        <div className="text-slate-300 truncate">{dash(lead.contato_nome)}</div>
                        {lead.contato_email && <div className="text-xs text-slate-500 truncate">{lead.contato_email}</div>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{dash(responsavel)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: corEstagio(lead.estagio) }} />
                          {labelEstagio(lead.estagio)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{etapaFollowup(lead.followups_enviados)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-slate-300 tabular-nums">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: corScore(lead.score) }} />
                          {lead.score ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-300 whitespace-nowrap">{dash(cidadeUf)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-400 whitespace-nowrap">{lead.ultimo_contato ? formatDate(lead.ultimo_contato) : '—'}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border-subtle)] text-slate-400 whitespace-nowrap">{lead.created_at ? formatDate(lead.created_at) : '—'}</td>
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
        className="px-6 py-3 shrink-0 border-t border-[var(--border)] bg-[var(--bg-base)]"
      />

      {/* Painel lateral completo (componente compartilhado em components/leads) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        usingSupabase={!useFallback}
        contexto="base"
      />

      {modal === 'novo' && (
        <NovoLeadModal onClose={() => setModal(null)} onCreated={() => setReloadKey(k => k + 1)} />
      )}
      {modal === 'importar' && (
        <ImportarLeadsModal onClose={() => setModal(null)} onImported={() => setReloadKey(k => k + 1)} />
      )}
    </div>
  );
}
