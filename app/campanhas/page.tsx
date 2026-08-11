'use client';

import { useState, useEffect, useCallback } from 'react';
import { Megaphone, Plus, Play, Pause, CheckCircle2, Target } from 'lucide-react';

interface Campanha {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: string | null;
  status: string;
  meta_leads: number | null;
  iniciada_em: string | null;
  criado_em: string;
}

const FILTROS = [
  { id: 'ativa', label: 'Ativas' },
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'pausada', label: 'Pausadas' },
  { id: 'concluida', label: 'Concluídas' },
  { id: '', label: 'Todas' },
] as const;

const BADGE: Record<string, string> = {
  rascunho: 'bg-slate-500/15 text-slate-400',
  ativa: 'bg-green-500/15 text-green-400',
  pausada: 'bg-amber-500/15 text-amber-400',
  concluida: 'bg-indigo-500/15 text-indigo-300',
};

// Ações permitidas por status (espelha o ciclo de vida do repository).
const ACOES: Record<string, { para: string; label: string; icon: typeof Play }[]> = {
  rascunho: [{ para: 'ativa', label: 'Ativar', icon: Play }],
  ativa: [{ para: 'pausada', label: 'Pausar', icon: Pause }, { para: 'concluida', label: 'Concluir', icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', icon: Play }, { para: 'concluida', label: 'Concluir', icon: CheckCircle2 }],
  concluida: [],
};

export default function CampanhasPage() {
  const [itens, setItens] = useState<Campanha[]>([]);
  const [filtro, setFiltro] = useState<string>('ativa');
  const [carregando, setCarregando] = useState(true);
  const [negado, setNegado] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = filtro ? `?status=${filtro}` : '';
      const res = await fetch(`/api/campanhas${qs}`);
      if (res.status === 403) { setNegado(true); setItens([]); return; }
      const r = res.ok ? await res.json() : { campanhas: [] };
      setItens(r.campanhas ?? []);
    } catch {
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criar() {
    if (!novoNome.trim() || salvando) return;
    setSalvando(true);
    try {
      await fetch('/api/campanhas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: novoNome.trim() }),
      });
      setNovoNome('');
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function transicionar(id: string, status: string) {
    await fetch(`/api/campanhas/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    carregar();
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center">
          <Megaphone size={20} className="text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Campanhas</h1>
          <p className="text-sm text-slate-400 mt-0.5">Ativações sobre um público, executadas pelo motor de Workflows.</p>
        </div>
      </div>

      {negado ? (
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-10 text-center text-slate-400 text-sm">
          Você não tem permissão para ver campanhas (requer <code className="text-indigo-300">campaigns.view</code>).
        </div>
      ) : (
        <>
          <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') criar(); }}
                placeholder="Nova campanha (nome)…"
                className="flex-1 bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500" />
              <button onClick={criar} disabled={!novoNome.trim() || salvando}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                <Plus size={15} /> Criar
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-2">Nasce como rascunho. Vincule um workflow e um público para operar.</p>
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
              <div className="p-10 text-center text-slate-500 text-sm">Nenhuma campanha.</div>
            ) : (
              <ul className="divide-y divide-[#2a3147]">
                {itens.map((c) => (
                  <li key={c.id} className="px-5 py-3 flex items-start gap-3 hover:bg-[#0f1117] transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-100">{c.nome}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${BADGE[c.status] ?? BADGE.rascunho}`}>{c.status}</span>
                        {c.tipo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-400">{c.tipo}</span>}
                      </div>
                      {c.descricao && <div className="text-xs text-slate-500 mt-0.5">{c.descricao}</div>}
                      {c.meta_leads != null && <div className="text-xs text-slate-600 mt-0.5 inline-flex items-center gap-1"><Target size={11} /> meta {c.meta_leads} leads</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {(ACOES[c.status] ?? []).map(({ para, label, icon: Icon }) => (
                        <button key={para} onClick={() => transicionar(c.id, para)}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-[#252b3b] text-slate-200 hover:bg-[#2f3750] transition-colors inline-flex items-center gap-1">
                          <Icon size={13} /> {label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
