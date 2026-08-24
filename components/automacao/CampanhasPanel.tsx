'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, Play, Pause, CheckCircle2, Megaphone, Users, MessageSquare, Coins,
  Search, FileSpreadsheet, PencilLine, ArrowRight, Activity, Info,
  CalendarDays,
} from 'lucide-react';
import ImportarLeadsModal from '@/components/leads/ImportarLeadsModal';
import { type Campanha, STATUS_BADGE, STATUS_LABEL, resumoPublico } from './tiposCampanha';
import { campanhaEhDisparoUnico } from '@/lib/campanhas/configuracaoGuiada';

// Painel principal da aba Campanhas (mockup 01): KPIs, filtros, tabela densa,
// "Próximas ações" e "Desempenho recente". Dado REAL de /api/campanhas. Métricas
// atribuídas (contatos/respostas/receita/ROI) dependem do vínculo campanha↔
// resultados (campanha_id — fora do escopo desta fase): aparecem como "não
// calculável", nunca inventadas. "Importar leads" reusa o ImportarLeadsModal
// existente (mesma importação da Base de Leads). "Nova campanha" abre o wizard
// em página própria.

const FILTROS = [
  { id: '', label: 'Todas' },
  { id: 'ativa', label: 'Ativas' },
  { id: 'pausada', label: 'Pausadas' },
  { id: 'concluida', label: 'Concluídas' },
] as const;

const ACOES: Record<string, { para: string; label: string; Icon: typeof Play }[]> = {
  rascunho: [{ para: 'ativa', label: 'Ativar', Icon: Play }],
  ativa: [{ para: 'pausada', label: 'Pausar', Icon: Pause }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', Icon: Play }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  concluida: [],
};

const NC = <span className="text-slate-500 text-xs" title="Não calculável — requer vínculo campanha↔resultados (fora do escopo desta fase)">—</span>;

export default function CampanhasPanel() {
  const router = useRouter();
  const [itens, setItens] = useState<Campanha[]>([]);
  const [ativasTotal, setAtivasTotal] = useState(0);
  const [emCadencia, setEmCadencia] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [negado, setNegado] = useState(false);
  const [importar, setImportar] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const qs = filtro ? `?status=${filtro}` : '';
      const [res, resAtivas, resMet] = await Promise.all([
        fetch(`/api/campanhas${qs}`),
        fetch('/api/campanhas?status=ativa'),
        fetch('/api/campanhas/metricas'),
      ]);
      if (res.status === 403) { setNegado(true); setItens([]); return; }
      const r = res.ok ? await res.json() : { campanhas: [] };
      setItens(r.campanhas ?? []);
      const ra = resAtivas.ok ? await resAtivas.json() : { campanhas: [] };
      setAtivasTotal((ra.campanhas ?? []).length);
      const met = resMet.ok ? await resMet.json() : null;
      setEmCadencia(met?.emCadencia ?? null);
    } catch {
      setItens([]);
    } finally {
      setCarregando(false);
    }
  }, [filtro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function transicionar(id: string, status: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    carregar();
  }

  const filtrados = useMemo(
    () => itens.filter((c) => !busca.trim() || c.nome.toLowerCase().includes(busca.trim().toLowerCase())),
    [itens, busca],
  );

  // "Próximas ações" derivadas de estado REAL das campanhas.
  const proximas = useMemo(() => {
    const rascunhos = itens.filter((c) => c.status === 'rascunho').length;
    const ativasSemWf = itens.filter((c) => c.status === 'ativa' && !c.workflow_id).length;
    const pausadas = itens.filter((c) => c.status === 'pausada').length;
    return [
      { n: rascunhos, label: 'rascunho(s) aguardando configuração/ativação' },
      { n: ativasSemWf, label: 'ativa(s) sem cadência vinculada' },
      { n: pausadas, label: 'pausada(s) para retomar' },
    ].filter((x) => x.n > 0);
  }, [itens]);

  if (negado) {
    return (
      <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-10 text-center text-slate-400 text-sm">
        Você não tem permissão para ver campanhas (requer <code className="text-indigo-300">campaigns.view</code>).
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {importar && <ImportarLeadsModal onClose={() => setImportar(false)} onImported={() => setImportar(false)} />}

      {/* Ações do topo */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">Ativações sobre um público, executadas pelo motor de Workflows.</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportar(true)}
            className="text-sm px-3 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] inline-flex items-center gap-1.5">
            <FileSpreadsheet size={14} /> Importar leads
          </button>
          <Link href="/automacao/campanhas/nova"
            className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 inline-flex items-center gap-1">
            <Plus size={15} /> Nova campanha
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi Icon={Megaphone} cor="text-indigo-400" label="Campanhas ativas" valor={String(ativasTotal)} />
        <Kpi Icon={Users} cor="text-sky-400" label="Contatos em cadência" valor={emCadencia != null ? String(emCadencia) : undefined} naoCalc={emCadencia == null} />
        <Kpi Icon={MessageSquare} cor="text-green-400" label="Respostas" naoCalc />
        <Kpi Icon={Coins} cor="text-amber-400" label="Conversões" naoCalc />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Campanhas: filtros + tabela */}
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#2a3147] flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-200 mr-1">Campanhas</span>
            <div className="flex items-center gap-1">
              {FILTROS.map((f) => (
                <button key={f.id || 'todas'} onClick={() => setFiltro(f.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filtro === f.id ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:text-slate-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="ml-auto relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha…"
                className="w-48 bg-[#0f1117] border border-[#2a3147] rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          {/* Cabeçalho da tabela SEMPRE visível (mesmo vazio) */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3147] text-[11px] uppercase tracking-wide text-slate-500">
                <th className="text-left font-medium px-5 py-2.5">Campanha</th>
                <th className="text-left font-medium px-2 py-2.5">Público</th>
                <th className="text-right font-medium px-2 py-2.5">Respostas</th>
                <th className="text-right font-medium px-2 py-2.5">Oport.</th>
                <th className="text-right font-medium px-2 py-2.5">Receita</th>
                <th className="text-right font-medium px-2 py-2.5">ROI</th>
                <th className="text-left font-medium px-2 py-2.5">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500 text-sm">Carregando…</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500 text-sm">
                  Nenhuma campanha {filtro && `(${STATUS_LABEL[filtro] ?? filtro})`}. Crie a primeira em <b className="text-slate-300">Nova campanha</b>.
                </td></tr>
              ) : filtrados.map((c) => (
                <tr key={c.id} onClick={() => router.push(`/automacao/campanhas/${c.id}`)}
                  className="border-b border-[#2a3147] last:border-0 hover:bg-[#0f1117] transition-colors cursor-pointer">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-100">{c.nome}</div>
                    <div className="text-xs text-slate-500">{c.tipo ?? 'campanha'}{c.meta_leads != null && ` · meta ${c.meta_leads}`}</div>
                  </td>
                  <td className="px-2 py-3 text-xs text-slate-400 max-w-[160px] truncate">{resumoPublico(c.publico)}</td>
                  <td className="px-2 py-3 text-right">{NC}</td>
                  <td className="px-2 py-3 text-right">{NC}</td>
                  <td className="px-2 py-3 text-right">{NC}</td>
                  <td className="px-2 py-3 text-right">{NC}</td>
                  <td className="px-2 py-3"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? STATUS_BADGE.rascunho}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {c.status === 'rascunho' && (
                        <Link href={`/automacao/campanhas/${c.id}/editar`} onClick={(e) => e.stopPropagation()}
                          className="text-xs px-2 py-1.5 rounded-lg bg-[#252b3b] text-slate-200 hover:bg-[#2f3750] inline-flex items-center gap-1">
                          <PencilLine size={12} /> Editar
                        </Link>
                      )}
                      {!campanhaEhDisparoUnico(c.tipo) && (c.status === 'ativa' || c.status === 'pausada') && (
                        <Link href={`/automacao/campanhas/${c.id}`} onClick={(e) => e.stopPropagation()}
                          className="text-xs px-2 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 inline-flex items-center gap-1">
                          <CalendarDays size={12} /> Editar agenda
                        </Link>
                      )}
                      {(ACOES[c.status] ?? []).map(({ para, label, Icon }) => (
                        <button key={para} onClick={(e) => transicionar(c.id, para, e)}
                          className="text-xs px-2 py-1.5 rounded-lg bg-[#252b3b] text-slate-200 hover:bg-[#2f3750] inline-flex items-center gap-1">
                          <Icon size={12} /> {label}
                        </button>
                      ))}
                      <ArrowRight size={13} className="text-slate-600" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Próximas ações */}
        <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5 self-start">
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Activity size={15} className="text-indigo-400" /> Próximas ações</h3>
          {proximas.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhuma ação pendente nas campanhas carregadas.</p>
          ) : (
            <ul className="space-y-2.5">
              {proximas.map((p, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-300 text-sm font-bold shrink-0">{p.n}</span>
                  <span className="text-xs text-slate-400 pt-1">{p.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Desempenho recente */}
      <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5">
        <h3 className="font-semibold text-slate-200 text-sm mb-1">Desempenho recente</h3>
        <p className="text-xs text-slate-500 mb-4">Respostas e oportunidades atribuídas às campanhas ao longo do tempo.</p>
        <div className="h-40 rounded-lg bg-[#0f1117] border border-dashed border-[#2a3147] flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Info size={14} className="text-slate-600" />
            Sem desempenho atribuído ainda — requer vínculo campanha↔resultados (fora do escopo desta fase).
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ Icon, cor, label, valor, naoCalc }: { Icon: typeof Megaphone; cor: string; label: string; valor?: string; naoCalc?: boolean }) {
  return (
    <div className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-5 py-4">
      <div className="flex items-center gap-2 text-xs text-slate-500"><Icon size={15} className={cor} /> {label}</div>
      <div className={`text-2xl font-bold mt-1 ${naoCalc ? 'text-slate-500' : 'text-slate-100'}`}>{naoCalc ? '—' : valor}</div>
      {naoCalc && <div className="text-[10px] text-slate-600 mt-0.5">não calculável</div>}
    </div>
  );
}
