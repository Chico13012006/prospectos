'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Plus, Loader2 } from 'lucide-react';
import { getPipelineFiltrosOpcoes } from '@/lib/api';
import PipelineColumn from '@/components/pipeline/PipelineColumn';
import GlobalFilters, { type GlobalFilterState } from '@/components/pipeline/GlobalFilters';
import LeadPanel from '@/components/leads/LeadPanel';
import { COLUNAS, COLUNAS_CADENCIA } from '@/lib/pipeline-stages';

export default function PipelinePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<GlobalFilterState>({ search: '', responsavel: '', segmento: '', canal: '' });
  const [vista, setVista] = useState<'comercial' | 'cadencia'>('comercial'); // aba do board
  const [filtroOpcoes, setFiltroOpcoes] = useState<{ responsaveis: string[]; segmentos: string[]; canais: string[] }>({ responsaveis: [], segmentos: [], canais: [] });
  const [reloadKey, setReloadKey] = useState(0); // bump -> colunas refazem o fetch (após mutação)
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);

  // Cada PipelineColumn busca os seus leads server-side (paginado + COUNT). No
  // mount só fazemos uma sonda leve — carregar as opções dos filtros — que também
  // serve de teste de conexão com o Supabase.
  const bumpReload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    getPipelineFiltrosOpcoes()
      .then(opts => { setFiltroOpcoes(opts); setLoading(false); })
      .catch(err => { console.error('Erro ao carregar pipeline:', err); setUseFallback(true); setLoading(false); });
  }, []);

  // Supabase é fonte ativa quando carregou sem erro (mesmo que vazio)
  const usingSupabase = !useFallback && !loading;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-3 flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Pipeline de Contato</h1>
          <p className="text-sm text-slate-400 mt-0.5">CRM de prospecção — Kanban por etapa</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 text-sm text-slate-300 border border-[#2a3147] px-3 py-2 rounded-lg hover:bg-[#0f1117]">
            <Settings size={14} /> Configurar automações
          </button>
          <button
            className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            <Plus size={14} /> Novo lead
          </button>
        </div>
      </div>

      {/* Filtros globais + abas (Comercial x Cadência) */}
      <div className="px-6 pb-3 flex items-center gap-2 flex-wrap shrink-0">
        {/* Aba: forma de AGRUPAR os mesmos leads (não muda os estágios do motor) */}
        <div className="flex items-center rounded-lg border border-[#2a3147] bg-[#1a1f2e] p-0.5">
          {([
            { id: 'comercial', label: 'Comercial' },
            { id: 'cadencia', label: 'Cadência' },
          ] as const).map(v => (
            <button
              key={v.id}
              onClick={() => setVista(v.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                vista === v.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <GlobalFilters
          value={filtros}
          onChange={setFiltros}
          responsaveis={filtroOpcoes.responsaveis}
          segmentos={filtroOpcoes.segmentos}
          canais={filtroOpcoes.canais}
        />
      </div>

      {/* Área principal — ocupa o resto da altura; o scroll é por coluna */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Carregando leads...</span>
          </div>
        ) : !usingSupabase ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
            <span className="text-sm font-medium text-slate-400">Sem conexão com os dados.</span>
            <span className="text-xs">Verifique a conexão com o Supabase.</span>
          </div>
        ) : vista === 'cadencia' ? (
          /* Visão CADÊNCIA: mesmos leads, agrupados por nº de follow-up */
          <div className="h-full flex gap-4 overflow-x-auto px-6 pb-4">
            {COLUNAS_CADENCIA.map(col => (
              <PipelineColumn
                key={col.id}
                stage={col}
                filtros={filtros}
                selectedId={selectedId}
                onSelect={setSelectedId}
                reloadKey={reloadKey}
                chipKind={col.chip}
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex gap-4 overflow-x-auto px-6 pb-4">
            {COLUNAS.map(col => (
              <PipelineColumn
                key={col.id}
                stage={col}
                filtros={filtros}
                selectedId={selectedId}
                onSelect={setSelectedId}
                reloadKey={reloadKey}
                comFiltroData={col.tipo === 'reservatorio'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Painel lateral completo do lead (compartilhado com a Base de Leads) */}
      <LeadPanel
        leadId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={bumpReload}
        usingSupabase={usingSupabase}
        contexto="pipeline"
      />
    </div>
  );
}
