'use client';

import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Save, Kanban, ShieldCheck, Check } from 'lucide-react';

// Painel de Processo comercial — Processo comercial saiu da sidebar e virou parte
// de Configurações. Nomenclaturas, parâmetros de renovação/ROI, pipelines e
// permissões, respeitando o tenant. Dado real de /api/configuracoes/workspace,
// /api/pipelines e /api/rbac/permissoes.

type Aba = 'geral' | 'pipelines' | 'permissoes';

interface Config {
  nomenclaturas?: Record<string, string>;
  renovacao?: { antecedenciaDias?: number };
  roi?: { custoMensal?: number };
}
interface Estagio { id: string; chave: string; nome: string; papel: string; cor: string | null }
interface Pipeline { id: string; nome: string; tipo: string; ativo: boolean; estagios: Estagio[] }
interface RbacView { permissoes: string[]; porRole: Record<string, string[]>; minhas: string[]; role: string }

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
          {pipelines.length === 0 ? <div className="text-sm text-slate-500">Nenhum pipeline.</div> : pipelines.map((p) => (
            <div key={p.id} className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5">
              <div className="font-semibold text-slate-100">{p.nome} <span className="text-xs text-slate-500">({p.tipo})</span></div>
              <div className="flex flex-wrap gap-2 mt-3">
                {p.estagios.map((e) => (
                  <span key={e.id} className="text-xs px-2.5 py-1 rounded-full border" style={{ borderColor: (e.cor ?? '#2a3147') + '66', color: e.cor ?? '#cbd5e1' }}>
                    {e.nome} <span className="opacity-60">· {e.papel}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-600">Edição de estágios entra numa iteração seguinte — hoje é a referência (tabelas reais da migration 0014).</p>
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
