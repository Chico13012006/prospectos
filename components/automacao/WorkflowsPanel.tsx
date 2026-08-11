'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Workflow as WorkflowIcon, Plus, Loader2, X, CheckCircle2, PauseCircle, PencilLine,
  Zap, Layers, Users, Filter,
} from 'lucide-react';
import type { Workflow, StatusWorkflow } from '@/lib/workflows/types';
import { acharBlocoDef } from '@/lib/workflows/catalogo';

// Painel de Workflows — reusado dentro de Automação (aba Workflows). Lista o
// resumo enriquecido de /api/workflows; o editor continua em /workflows/[id].

type WorkflowResumo = Workflow & {
  gatilho_tipo: string | null;
  etapas: number;
  num_condicoes: number;
  em_execucao: number;
};

const STATUS_INFO: Record<StatusWorkflow, { label: string; chip: string; Icon: typeof CheckCircle2 }> = {
  rascunho: { label: 'Rascunho', chip: 'chip chip-muted', Icon: PencilLine },
  publicado: { label: 'Publicado', chip: 'chip chip-success', Icon: CheckCircle2 },
  pausado: { label: 'Pausado', chip: 'chip chip-warning', Icon: PauseCircle },
};

function gatilhoLabel(tipo: string | null): string {
  if (!tipo) return 'Sem gatilho';
  return acharBlocoDef(tipo)?.label ?? tipo;
}

function formatarData(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

export default function WorkflowsPanel() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch('/api/workflows');
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao carregar');
      setWorkflows(data.workflows ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar workflows');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  async function criar() {
    const nome = novoNome.trim();
    if (!nome || salvando) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao criar');
      router.push(`/workflows/${data.workflow.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar workflow');
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">
          {loading ? 'Carregando...' : `${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`}
          <span className="text-slate-600"> · automações por gatilho, condição e ações em sequência.</span>
        </p>
        <button
          onClick={() => { setNovoNome(''); setCriando(true); }}
          className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          <Plus size={15} /> Novo Workflow
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando workflows...</span>
        </div>
      ) : erro ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
          <span className="text-sm font-medium text-slate-400">{erro}</span>
          <button onClick={carregar} className="text-xs text-blue-400 hover:text-blue-300 underline">Tentar de novo</button>
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-3">
          <WorkflowIcon size={28} className="text-slate-600" />
          <span className="text-sm">Nenhum workflow ainda.</span>
          <button
            onClick={() => { setNovoNome(''); setCriando(true); }}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium"
          >
            Criar o primeiro
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((wf, i) => {
            const info = STATUS_INFO[wf.status];
            const temRascunho = wf.rascunho_definicao != null;
            const emExecucao = wf.em_execucao > 0;
            return (
              <Link
                key={wf.id}
                href={`/workflows/${wf.id}`}
                className={`card card-hover focus-ring p-4 block animate-in stagger-${Math.min(i + 1, 10)}`}
              >
                <div className="flex items-start gap-3 mb-3.5">
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-[var(--accent-soft)] text-[var(--accent)]">
                    <WorkflowIcon size={17} />
                  </span>
                  <h3 className="font-semibold text-slate-100 leading-snug min-w-0 truncate flex-1 pt-1">{wf.nome}</h3>
                  <span className={`${info.chip} shrink-0`}>
                    <info.Icon size={11} /> {info.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                      <Zap size={11} className="text-amber-400/80" /> Gatilho
                    </div>
                    <div className="text-xs font-medium text-slate-200 truncate" title={gatilhoLabel(wf.gatilho_tipo)}>
                      {gatilhoLabel(wf.gatilho_tipo)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                      <Layers size={11} className="text-sky-400/80" /> Etapas
                    </div>
                    <div className="text-xs font-medium text-slate-200">
                      {wf.etapas}
                      {wf.num_condicoes > 0 && (
                        <span className="text-slate-500 font-normal"> · <Filter size={9} className="inline -mt-0.5" /> {wf.num_condicoes}</span>
                      )}
                    </div>
                  </div>
                  <div className={`rounded-lg px-2.5 py-2 border ${emExecucao ? 'bg-[var(--success-soft)] border-[var(--success)]/30' : 'bg-[var(--bg-subtle)] border-[var(--border-subtle)]'}`}>
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                      <Users size={11} className={emExecucao ? 'text-[var(--success)]' : 'text-slate-500'} /> Em execução
                    </div>
                    <div className={`text-xs font-semibold ${emExecucao ? 'text-[var(--success)]' : 'text-slate-400'}`}>
                      {wf.em_execucao} {wf.em_execucao === 1 ? 'lead' : 'leads'}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span>Atualizado em {formatarData(wf.atualizado_em)}</span>
                  {wf.status !== 'rascunho' && temRascunho && (
                    <span className="chip chip-warning">alterações não publicadas</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {criando && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !salvando && setCriando(false)}>
          <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-100">Novo workflow</h3>
              <button onClick={() => !salvando && setCriando(false)} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>
            <label className="block text-sm text-slate-400 mb-1.5">Nome</label>
            <input
              autoFocus
              value={novoNome}
              onChange={e => setNovoNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') criar(); }}
              placeholder="Ex.: Reengajar leads que não responderam"
              className="w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCriando(false)} disabled={salvando} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[#0f1117]">Cancelar</button>
              <button
                onClick={criar}
                disabled={!novoNome.trim() || salvando}
                className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {salvando && <Loader2 size={14} className="animate-spin" />} Criar e editar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
