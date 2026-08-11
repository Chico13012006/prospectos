'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Loader2, PencilLine, Play, Pause, CheckCircle2, Building2, Users,
  MessageSquare, BarChart3, ClipboardList, Workflow, TrendingUp, Info, Target,
} from 'lucide-react';
import { type Campanha, type Publico, STATUS_BADGE, STATUS_LABEL, fmtData, resumoPublico } from './tiposCampanha';

// Detalhe de campanha com abas internas. Visão geral/Empresas/Decisores/Mensagens
// mostram o que REALMENTE persiste (colunas + publico jsonb + workflow vinculado).
// Resultados tem a estrutura do mockup, mas como não há vínculo campanha↔resultados
// (campanha_id em oportunidades/execuções — fora do escopo desta fase), cada
// métrica atribuída aparece como "não calculável". NUNCA um valor inventado.

type Aba = 'geral' | 'empresas' | 'decisores' | 'mensagens' | 'resultados';
const ABAS: { id: Aba; label: string; Icon: typeof Building2 }[] = [
  { id: 'geral', label: 'Visão geral', Icon: ClipboardList },
  { id: 'empresas', label: 'Empresas', Icon: Building2 },
  { id: 'decisores', label: 'Decisores', Icon: Users },
  { id: 'mensagens', label: 'Mensagens', Icon: MessageSquare },
  { id: 'resultados', label: 'Resultados', Icon: BarChart3 },
];

const ACOES: Record<string, { para: string; label: string; Icon: typeof Play }[]> = {
  rascunho: [{ para: 'ativa', label: 'Ativar', Icon: Play }],
  ativa: [{ para: 'pausada', label: 'Pausar', Icon: Pause }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', Icon: Play }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  concluida: [],
};

const card = 'bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5';
const NC = <span className="text-slate-500">não calculável</span>;

export default function CampanhaDetalhe({ id }: { id: string }) {
  const router = useRouter();
  const [c, setC] = useState<Campanha | null>(null);
  const [workflowNome, setWorkflowNome] = useState<string | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [aba, setAba] = useState<Aba>('geral');
  const [agindo, setAgindo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/campanhas/${id}`);
      if (!r.ok) { setEstado('erro'); return; }
      const d = await r.json();
      setC(d.campanha); setEstado('ok');
      if (d.campanha?.workflow_id) {
        const rw = await fetch('/api/workflows');
        const dw = rw.ok ? await rw.json() : { workflows: [] };
        setWorkflowNome((dw.workflows ?? []).find((w: { id: string; nome: string }) => w.id === d.campanha.workflow_id)?.nome ?? null);
      }
    } catch { setEstado('erro'); }
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function transicionar(status: string) {
    setAgindo(true);
    try {
      await fetch(`/api/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      await carregar();
    } finally { setAgindo(false); }
  }

  if (estado === 'carregando') return <div className="flex items-center justify-center gap-2 py-24 text-slate-500"><Loader2 size={18} className="animate-spin" /> Carregando campanha…</div>;
  if (estado === 'erro' || !c) return (
    <div className="p-6">
      <Link href="/automacao?tab=campanhas" className="text-sm text-indigo-300 hover:text-indigo-200">← Campanhas</Link>
      <div className="text-center py-20 text-slate-400 text-sm">Campanha não encontrada.</div>
    </div>
  );

  const pub: Publico = c.publico ?? {};
  const emp = pub.empresas ?? {};
  const dec = pub.decisores ?? {};

  return (
    <div className="p-6 max-w-[100rem] mx-auto space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
            <Link href="/automacao?tab=campanhas" className="hover:text-slate-300">Campanhas</Link>
            <ChevronRight size={12} /> <span className="text-slate-400 truncate">{c.nome}</span>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">{c.nome}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? STATUS_BADGE.rascunho}`}>{STATUS_LABEL[c.status] ?? c.status}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(ACOES[c.status] ?? []).map(({ para, label, Icon }) => (
            <button key={para} onClick={() => transicionar(para)} disabled={agindo}
              className="text-sm px-3 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] disabled:opacity-40 inline-flex items-center gap-1">
              <Icon size={14} /> {label}
            </button>
          ))}
          {c.status === 'rascunho' && (
            <Link href={`/automacao/campanhas/${c.id}/editar`}
              className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 inline-flex items-center gap-1">
              <PencilLine size={14} /> Editar campanha
            </Link>
          )}
        </div>
      </div>

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-[#2a3147] overflow-x-auto">
        {ABAS.map(({ id: aid, label, Icon }) => (
          <button key={aid} onClick={() => setAba(aid)}
            className={`px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 border-b-2 -mb-px transition-colors whitespace-nowrap ${aba === aid ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {aba === 'geral' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={card}>
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Dados</h3>
            <div className="space-y-2 text-sm">
              <Linha k="Tipo" v={c.tipo ?? '—'} />
              <Linha k="Objetivo" v={pub.objetivo ?? c.descricao ?? '—'} />
              <Linha k="Responsável" v={pub.responsavel ?? '—'} />
              <Linha k="Idioma" v={pub.idioma ?? '—'} />
              <Linha k="Meta de leads" v={c.meta_leads != null ? String(c.meta_leads) : '—'} />
              <Linha k="Prazo" v={pub.prazo ? fmtData(pub.prazo) : '—'} />
            </div>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Ciclo</h3>
            <div className="space-y-2 text-sm">
              <Linha k="Status" v={STATUS_LABEL[c.status] ?? c.status} />
              <Linha k="Público" v={resumoPublico(c.publico)} />
              <Linha k="Cadência" v={workflowNome ?? (c.workflow_id ? 'workflow vinculado' : '— (sem workflow)')} />
              <Linha k="Criada em" v={fmtData(c.criado_em)} />
              <Linha k="Iniciada em" v={fmtData(c.iniciada_em)} />
              <Linha k="Concluída em" v={fmtData(c.concluida_em)} />
            </div>
          </div>
        </div>
      )}

      {aba === 'empresas' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Building2 size={15} className="text-indigo-400" /> Critérios de empresas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Linha k="Fonte" v={emp.fonte === 'maps' ? 'Google Maps Extractor (não configurado)' : 'Base de leads existente'} />
            <Linha k="País" v={emp.pais ?? '—'} />
            <Linha k="Segmentos" v={emp.segmento ?? '—'} />
            <Linha k="Cidades / regiões" v={emp.cidades ?? '—'} />
            <Linha k="Limite" v={emp.limite != null ? String(emp.limite) : '—'} />
            <Linha k="Remover duplicados" v={emp.removerDuplicados ? 'Sim' : 'Não'} />
            <Linha k="Exigir site ativo" v={emp.exigirSite ? 'Sim' : 'Não'} />
          </div>
          <div className="flex items-start gap-2 text-xs text-slate-500 mt-4 bg-[#0f1117] border border-[#2a3147] rounded-lg p-3">
            <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
            <span>As empresas efetivas são resolvidas pelo motor (Workflows) sobre a base ao ativar. A lista materializada por campanha depende do vínculo campanha↔leads (fora do escopo desta fase).</span>
          </div>
        </div>
      )}

      {aba === 'decisores' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Users size={15} className="text-indigo-400" /> Critérios de decisores</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <Linha k="Departamento" v={dec.departamento ?? '—'} />
            <Linha k="Cargos-alvo" v={dec.cargos ?? '—'} />
            <Linha k="Senioridade" v={dec.senioridade ?? '—'} />
            <Linha k="Máx. por empresa" v={dec.maxPorEmpresa != null ? String(dec.maxPorEmpresa) : '—'} />
            <Linha k="Exigir e-mail validado" v={dec.exigirEmail ? 'Sim' : 'Não'} />
            <Linha k="Exigir telefone / WhatsApp" v={dec.exigirTelefone ? 'Sim' : 'Não'} />
          </div>
        </div>
      )}

      {aba === 'mensagens' && (
        <div className={card}>
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Workflow size={15} className="text-indigo-400" /> Cadência de mensagens</h3>
          {c.workflow_id ? (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#2a3147] bg-[#0f1117]">
              <span className="text-sm text-slate-200 inline-flex items-center gap-2"><Workflow size={15} className="text-indigo-400" /> {workflowNome ?? 'Workflow vinculado'}</span>
              <Link href={`/workflows/${c.workflow_id}`} className="text-xs text-indigo-300 hover:text-indigo-200">Abrir no builder →</Link>
            </div>
          ) : (
            <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a3147] rounded-lg p-4">
              Nenhuma cadência vinculada. Edite a campanha e escolha um workflow na etapa Cadência.
            </div>
          )}
          <p className="text-xs text-slate-600 mt-3">As mensagens por etapa vivem no workflow (motor reusado). A telemetria por mensagem depende do vínculo campanha↔execuções (fora do escopo desta fase).</p>
        </div>
      )}

      {aba === 'resultados' && (
        <div className="space-y-5">
          <div className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg p-3">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span><b>Resultados por campanha ainda não são calculáveis.</b> A atribuição exige ligar cada oportunidade/execução à campanha (coluna <code>campanha_id</code> — migration fora do escopo desta fase). Até lá, nenhum número é estimado: os campos abaixo mostram &quot;não calculável&quot;.</span>
          </div>

          {/* 6 mini KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[['Empresas', Building2], ['Decisores', Users], ['Contatos válidos', Users], ['Mensagens', MessageSquare], ['Respostas', MessageSquare], ['Oportunidades', Target]].map(([label, Icon]) => {
              const I = Icon as typeof Building2;
              return (
                <div key={label as string} className="bg-[#1a1f2e] border border-[#2a3147] rounded-xl px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><I size={13} /> {label as string}</div>
                  <div className="text-lg font-bold text-slate-400 mt-1">—</div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Funil */}
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Funil da campanha</h3>
              <div className="space-y-2">
                {['Empresas', 'Contatos válidos', 'Mensagens', 'Respostas', 'Oportunidades', 'Visitas', 'Clientes'].map((etapa) => (
                  <div key={etapa} className="flex items-center gap-3 text-sm">
                    <span className="w-32 shrink-0 text-slate-400">{etapa}</span>
                    <div className="flex-1 h-2 rounded-full bg-[#0f1117] border border-[#2a3147]" />
                    <span className="w-16 text-right text-slate-500 text-xs">{NC}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Retorno */}
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><TrendingUp size={15} className="text-indigo-400" /> Retorno da campanha</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Retorno k="Receita atribuída" />
                <Retorno k="Custo total" />
                <Retorno k="ROI" />
                <Retorno k="Custo por oportunidade" />
                <Retorno k="CAC" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Desempenho das mensagens</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#2a3147] text-xs text-slate-500">
                  <th className="text-left py-2">Etapa</th><th className="text-right py-2">Enviadas</th><th className="text-right py-2">Abertas</th><th className="text-right py-2">Respostas</th>
                </tr></thead>
                <tbody><tr><td colSpan={4} className="py-8 text-center text-slate-500 text-xs">Sem telemetria de mensagens por campanha — {NC}.</td></tr></tbody>
              </table>
            </div>
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Negócios atribuídos</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#2a3147] text-xs text-slate-500">
                  <th className="text-left py-2">Oportunidade</th><th className="text-right py-2">Valor</th><th className="text-right py-2">Status</th>
                </tr></thead>
                <tbody><tr><td colSpan={3} className="py-8 text-center text-slate-500 text-xs">Nenhum negócio atribuído a esta campanha ainda.</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start gap-3 border-b border-[#2a3147] pb-2"><span className="text-slate-500 w-40 shrink-0">{k}</span><span className="text-slate-200">{v}</span></div>;
}
function Retorno({ k }: { k: string }) {
  return (
    <div className="rounded-lg bg-[#0f1117] border border-[#2a3147] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="text-base font-bold text-slate-400 mt-0.5">—</div>
    </div>
  );
}
