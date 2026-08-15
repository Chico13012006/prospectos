'use client';

import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Save, Kanban, ShieldCheck, Check, Loader2, Plus, Pencil, X } from 'lucide-react';

// Painel de Processo comercial — Nomenclaturas, parâmetros de renovação/ROI,
// pipelines editáveis e permissões. Dado real de /api/configuracoes/workspace,
// /api/pipelines e /api/rbac/permissoes.

type Aba = 'geral' | 'pipelines' | 'permissoes';

interface Config {
  nomenclaturas?: Record<string, string>;
  renovacao?: { antecedenciaDias?: number };
  roi?: { custoMensal?: number };
}
interface Estagio { id: string; chave: string; nome: string; papel: string; cor: string | null; ordem: number }
interface Pipeline { id: string; nome: string; tipo: string; ativo: boolean; estagios: Estagio[] }
interface RbacView { permissoes: string[]; porRole: Record<string, string[]>; minhas: string[]; role: string }

const PAPEIS = ['inicial', 'normal', 'ganho', 'perdido'] as const;

function slugificar(nome: string, sufixo: string | number) {
  return nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + sufixo;
}

export default function ProcessoComercialPanel() {
  const [aba, setAba] = useState<Aba>('geral');
  const [config, setConfig] = useState<Config | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [antecedencia, setAntecedencia] = useState('');
  const [custo, setCusto] = useState('');
  const [nomeLead, setNomeLead] = useState('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [rbac, setRbac] = useState<RbacView | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Estado de edição de pipeline
  const [criando, setCriando] = useState(false);
  const [editBuffers, setEditBuffers] = useState<Record<string, Estagio[]>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [salvoId, setSalvoId] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [c, p, r] = await Promise.all([
      fetch('/api/configuracoes/workspace').then((x) => (x.ok ? x.json() : null)),
      fetch('/api/pipelines').then((x) => (x.ok ? x.json() : { pipelines: [] })),
      fetch('/api/rbac/permissoes').then((x) => (x.ok ? x.json() : null)),
    ]);
    if (c) {
      setConfig(c.config); setPodeEditar(!!c.podeEditar);
      setAntecedencia(String(c.config?.renovacao?.antecedenciaDias ?? ''));
      setCusto(String(c.config?.roi?.custoMensal ?? ''));
      setNomeLead(c.config?.nomenclaturas?.lead ?? '');
    }
    setPipelines(p.pipelines ?? []);
    setRbac(r);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar() {
    if (salvando) return;
    setSalvando(true); setSalvo(false);
    try {
      const body: Record<string, unknown> = {};
      if (antecedencia.trim()) body.renovacaoAntecedenciaDias = Number(antecedencia);
      if (custo.trim()) body.roiCustoMensal = Number(custo);
      if (nomeLead.trim()) body.nomenclaturas = { ...(config?.nomenclaturas ?? {}), lead: nomeLead.trim() };
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.ok) { const j = await res.json(); setConfig(j.config); setSalvo(true); setTimeout(() => setSalvo(false), 2500); }
    } finally { setSalvando(false); }
  }

  async function criarPipeline() {
    if (criando) return;
    setCriando(true);
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Pipeline padrão', tipo: 'prospeccao' }),
      });
      if (res.ok) {
        const j = await res.json();
        setPipelines((prev) => [...prev, j.pipeline]);
        // Abre imediatamente em modo edição
        setEditBuffers((b) => ({ ...b, [j.pipeline.id]: j.pipeline.estagios }));
      }
    } finally { setCriando(false); }
  }

  function iniciarEdicao(pipeline: Pipeline) {
    setEditBuffers((b) => ({ ...b, [pipeline.id]: pipeline.estagios.map((e, i) => ({ ...e, ordem: i })) }));
  }

  function cancelarEdicao(pId: string) {
    setEditBuffers((b) => { const { [pId]: _, ...rest } = b; return rest; });
  }

  function atualizarEstagio(pId: string, idx: number, campo: keyof Estagio, valor: string) {
    setEditBuffers((b) => {
      const list = [...(b[pId] ?? [])];
      list[idx] = { ...list[idx], [campo]: valor };
      return { ...b, [pId]: list };
    });
  }

  function addEstagio(pId: string) {
    setEditBuffers((b) => {
      const list = b[pId] ?? [];
      const novo: Estagio = {
        id: '',
        chave: slugificar('estagio', Date.now()),
        nome: 'Novo estágio',
        papel: 'normal',
        cor: '#64748b',
        ordem: list.length,
      };
      return { ...b, [pId]: [...list, novo] };
    });
  }

  function removeEstagio(pId: string, idx: number) {
    setEditBuffers((b) => {
      const list = (b[pId] ?? []).filter((_, i) => i !== idx);
      return { ...b, [pId]: list };
    });
  }

  async function salvarPipeline(pId: string) {
    if (salvandoId) return;
    setSalvandoId(pId);
    try {
      const estagios = (editBuffers[pId] ?? []).map((e, i) => ({ ...e, ordem: i }));
      const res = await fetch(`/api/pipelines/${pId}/estagios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estagios }),
      });
      if (res.ok) {
        cancelarEdicao(pId);
        setSalvoId(pId);
        setTimeout(() => setSalvoId(null), 2000);
        await carregar();
      }
    } finally { setSalvandoId(null); }
  }

  const TABS: { id: Aba; label: string; icon: typeof SlidersHorizontal }[] = [
    { id: 'geral', label: 'Geral', icon: SlidersHorizontal },
    { id: 'pipelines', label: 'Pipelines', icon: Kanban },
    { id: 'permissoes', label: 'Permissões', icon: ShieldCheck },
  ];

  const input = 'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b border-[#2a3147]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px transition-colors ${aba === id ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {aba === 'geral' && (
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-6 space-y-5 max-w-2xl">
          {!podeEditar && <div className="text-xs text-amber-400">Somente leitura — requer a permissão workspace.configure para editar.</div>}
          <div>
            <label className="text-xs text-slate-400">Como chamar &quot;lead&quot; (nomenclatura)</label>
            <input className={input} value={nomeLead} onChange={(e) => setNomeLead(e.target.value)} disabled={!podeEditar} placeholder="Lead" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Renovação — antecedência (dias antes do vencimento)</label>
            <input className={input} value={antecedencia} onChange={(e) => setAntecedencia(e.target.value)} disabled={!podeEditar} inputMode="numeric" placeholder="45" />
          </div>
          <div>
            <label className="text-xs text-slate-400">ROI — custo mensal de referência (R$)</label>
            <input className={input} value={custo} onChange={(e) => setCusto(e.target.value)} disabled={!podeEditar} inputMode="decimal" placeholder="0" />
          </div>
          {podeEditar && (
            <button onClick={salvar} disabled={salvando}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
              {salvo ? <><Check size={15} /> Salvo</> : <><Save size={15} /> Salvar</>}
            </button>
          )}
        </div>
      )}

      {aba === 'pipelines' && (
        <div className="space-y-4">
          {pipelines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 bg-[#1a1f2e] border border-[#2a3147] rounded-xl gap-3">
              <Kanban size={32} className="text-slate-600" />
              <p className="text-slate-300 font-medium">Nenhum pipeline configurado</p>
              <p className="text-slate-500 text-sm text-center max-w-xs">
                Crie um pipeline para organizar as etapas do seu processo comercial.
              </p>
              {podeEditar ? (
                <button onClick={criarPipeline} disabled={criando}
                  className="mt-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1.5">
                  {criando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Criar pipeline padrão
                </button>
              ) : (
                <p className="text-xs text-amber-400">Sem permissão (workspace.configure) para criar pipeline.</p>
              )}
            </div>
          ) : (
            pipelines.map((p) => {
              const em = editBuffers[p.id];
              const editando = !!em;
              return (
                <div key={p.id} className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-100">
                      {p.nome} <span className="text-xs text-slate-500">({p.tipo})</span>
                    </div>
                    {!editando && podeEditar && (
                      <button onClick={() => iniciarEdicao(p)}
                        className="text-xs px-2.5 py-1 rounded border border-[#2a3147] text-slate-400 hover:text-slate-200 hover:border-indigo-500/50 inline-flex items-center gap-1">
                        <Pencil size={11} /> Editar
                      </button>
                    )}
                    {salvoId === p.id && !editando && (
                      <span className="text-xs text-green-400 inline-flex items-center gap-1">
                        <Check size={12} /> Salvo
                      </span>
                    )}
                  </div>

                  {editando ? (
                    <div className="space-y-2">
                      {em.map((e, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="color"
                            value={e.cor ?? '#64748b'}
                            onChange={(ev) => atualizarEstagio(p.id, i, 'cor', ev.target.value)}
                            className="w-7 h-7 rounded cursor-pointer border border-[#2a3147] bg-transparent p-0"
                            title="Cor do estágio"
                          />
                          <input
                            value={e.nome}
                            onChange={(ev) => atualizarEstagio(p.id, i, 'nome', ev.target.value)}
                            className="flex-1 bg-[#0f1117] border border-[#2a3147] rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                            placeholder="Nome do estágio"
                          />
                          <select
                            value={e.papel}
                            onChange={(ev) => atualizarEstagio(p.id, i, 'papel', ev.target.value)}
                            className="bg-[#0f1117] border border-[#2a3147] rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                          >
                            {PAPEIS.map((papel) => (
                              <option key={papel} value={papel}>{papel}</option>
                            ))}
                          </select>
                          <button onClick={() => removeEstagio(p.id, i)}
                            className="text-slate-600 hover:text-red-400 p-0.5 shrink-0" title="Remover estágio">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => addEstagio(p.id)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 pt-1">
                        <Plus size={12} /> Adicionar estágio
                      </button>
                      <div className="flex gap-2 pt-1 border-t border-[#2a3147]">
                        <button onClick={() => salvarPipeline(p.id)} disabled={salvandoId === p.id}
                          className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
                          {salvandoId === p.id
                            ? <><Loader2 size={12} className="animate-spin" /> Salvando…</>
                            : <><Save size={12} /> Salvar</>}
                        </button>
                        <button onClick={() => cancelarEdicao(p.id)}
                          className="px-3 py-1.5 rounded border border-[#2a3147] text-slate-400 text-xs hover:text-slate-200">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {p.estagios.map((e) => (
                        <span key={e.id} className="text-xs px-2.5 py-1 rounded-full border"
                          style={{ borderColor: (e.cor ?? '#2a3147') + '66', color: e.cor ?? '#cbd5e1' }}>
                          {e.nome} <span className="opacity-60">· {e.papel}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {aba === 'permissoes' && rbac && (
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5">
          <div className="text-sm text-slate-300 mb-3">Seu papel: <span className="text-indigo-300 font-semibold">{rbac.role}</span></div>
          <ul className="space-y-1.5">
            {rbac.permissoes.map((perm) => {
              const tem = rbac.minhas.includes(perm);
              return (
                <li key={perm} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${tem ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/40 text-slate-600'}`}>
                    {tem && <Check size={11} />}
                  </span>
                  <code className={tem ? 'text-slate-200' : 'text-slate-500'}>{perm}</code>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
