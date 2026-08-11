'use client';

import { useState, useEffect, useCallback } from 'react';
import { Building2, TrendingUp, Trophy, XCircle, Plus, CalendarDays } from 'lucide-react';

// Painel de Oportunidades — reusado dentro de Comercial (aba Oportunidades).
// Oportunidades deixou de ser página independente: seu dono único é o módulo
// Comercial (negociação/proposta). Mesma entidade das Fases 5-6 (tabela
// oportunidades 0022, /api/oportunidades) — sem segunda fonte de verdade.

interface Oportunidade {
  id: string;
  titulo: string;
  valor: number | null;
  moeda: string;
  probabilidade: number | null;
  status: string;
  origem: string | null;
  previsao_fechamento: string | null;
  empresa_id: string | null;
  criado_em: string;
  empresas?: { nome: string | null } | { nome: string | null }[] | null;
}

function nomeEmpresa(o: Oportunidade): string | null {
  const e = o.empresas;
  if (!e) return null;
  return Array.isArray(e) ? (e[0]?.nome ?? null) : (e.nome ?? null);
}
function fmtData(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}
function fmtValor(v: number | null, moeda = 'BRL'): string {
  if (v == null) return '—';
  try { return v.toLocaleString('pt-BR', { style: 'currency', currency: moeda }); } catch { return `${v}`; }
}

const FILTROS = [
  { id: 'aberta', label: 'Abertas' },
  { id: 'ganha', label: 'Ganhas' },
  { id: 'perdida', label: 'Perdidas' },
  { id: '', label: 'Todas' },
] as const;

const BADGE_STATUS: Record<string, string> = {
  aberta: 'bg-indigo-500/15 text-indigo-300',
  ganha: 'bg-green-500/15 text-green-400',
  perdida: 'bg-red-500/15 text-red-400',
};

export default function OportunidadesPanel() {
  const [itens, setItens] = useState<Oportunidade[]>([]);
  const [filtro, setFiltro] = useState<string>('aberta');
  const [carregando, setCarregando] = useState(true);
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novoValor, setNovoValor] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = filtro ? `?status=${filtro}` : '';
      const r = await fetch(`/api/oportunidades${qs}`).then((res) => (res.ok ? res.json() : { oportunidades: [] }));
      setItens(r.oportunidades ?? []);
    } catch {
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criar() {
    if (!novoTitulo.trim() || salvando) return;
    setSalvando(true);
    try {
      const valor = novoValor.trim() ? Number(novoValor.replace(',', '.')) : null;
      await fetch('/api/oportunidades', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: novoTitulo.trim(), valor: Number.isFinite(valor as number) ? valor : null }),
      });
      setNovoTitulo(''); setNovoValor('');
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(id: string, status: string) {
    await fetch(`/api/oportunidades/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    carregar();
  }

  const totalAbertas = itens.filter((o) => o.status === 'aberta').reduce((s, o) => s + (o.valor ?? 0), 0);
  const totalGanhas = itens.filter((o) => o.status === 'ganha').reduce((s, o) => s + (o.valor ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4 flex items-center gap-3">
          <TrendingUp size={20} className="text-indigo-400" />
          <div>
            <div className="text-xs text-slate-500">Em aberto (pipeline)</div>
            <div className="text-lg font-bold text-slate-100">{fmtValor(totalAbertas)}</div>
          </div>
        </div>
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4 flex items-center gap-3">
          <Trophy size={20} className="text-green-400" />
          <div>
            <div className="text-xs text-slate-500">Ganho (na visão atual)</div>
            <div className="text-lg font-bold text-green-400">{fmtValor(totalGanhas)}</div>
          </div>
        </div>
      </div>

      <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') criar(); }}
            placeholder="Nova oportunidade (título)…"
            className="flex-1 bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500" />
          <input value={novoValor} onChange={(e) => setNovoValor(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') criar(); }}
            placeholder="Valor (R$)" inputMode="decimal"
            className="sm:w-40 bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500" />
          <button onClick={criar} disabled={!novoTitulo.trim() || salvando}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1">
            <Plus size={15} /> Criar
          </button>
        </div>
      </div>

      <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#2a3147] flex items-center gap-1">
          {FILTROS.map((f) => (
            <button key={f.id || 'todas'} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filtro === f.id ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
        {carregando ? (
          <div className="p-10 text-center text-slate-500 text-sm">Carregando…</div>
        ) : itens.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">Nenhuma oportunidade.</div>
        ) : (
          <ul className="divide-y divide-[#2a3147]">
            {itens.map((o) => {
              const emp = nomeEmpresa(o);
              return (
                <li key={o.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[#0f1117] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-100">{o.titulo}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${BADGE_STATUS[o.status] ?? BADGE_STATUS.aberta}`}>{o.status}</span>
                      {o.origem && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-400">{o.origem}</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-300">{fmtValor(o.valor, o.moeda)}</span>
                      {o.probabilidade != null && <span>· {o.probabilidade}%</span>}
                      {emp && <span className="inline-flex items-center gap-1"><Building2 size={11} /> {emp}</span>}
                      <span className="inline-flex items-center gap-1"><CalendarDays size={11} /> prev. {fmtData(o.previsao_fechamento)}</span>
                    </div>
                  </div>
                  {o.status === 'aberta' && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button onClick={() => mudarStatus(o.id, 'ganha')}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-green-600/20 text-green-300 hover:bg-green-600/30 transition-colors inline-flex items-center gap-1">
                        <Trophy size={13} /> Ganha
                      </button>
                      <button onClick={() => mudarStatus(o.id, 'perdida')}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-red-600/15 text-red-300 hover:bg-red-600/25 transition-colors inline-flex items-center gap-1">
                        <XCircle size={13} /> Perdida
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
