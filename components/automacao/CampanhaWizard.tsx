'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, ArrowLeft, ArrowRight, Check, Building2, Users, Workflow, ClipboardList, Info } from 'lucide-react';

// Wizard de criação/edição de campanha (5 etapas). Persiste DE VERDADE na tabela
// `campanhas` (POST/PATCH /api/campanhas): nome/tipo/descricao/meta_leads →
// colunas; critérios de empresas/decisores + idioma/responsável/objetivo →
// `publico` jsonb; cadência → `workflow_id`. Nenhuma integração externa é
// inventada: a única fonte de empresas real no repo é a BASE existente de leads
// (não há extractor/Maps configurado) — o público final é resolvido pelo motor
// (Workflows) na ativação.

interface WorkflowOpc { id: string; nome: string; status: string }

// Estrutura do publico jsonb (persistida).
interface Publico {
  objetivo?: string;
  responsavel?: string;
  idioma?: string;
  empresas?: { fonte: string; segmento?: string; estado?: string; cidade?: string; limite?: number };
  decisores?: { cargos?: string; senioridade?: string; maxPorEmpresa?: number; exigirEmail?: boolean; exigirTelefone?: boolean };
}

export interface CampanhaEdit {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: string | null;
  meta_leads: number | null;
  workflow_id?: string | null;
  publico?: Publico | null;
}

interface Props {
  campanha?: CampanhaEdit | null; // presente = edição de rascunho
  onClose: () => void;
  onSaved: () => void;
}

type Etapa = 0 | 1 | 2 | 3 | 4;
const PASSOS = [
  { label: 'Visão geral', Icon: ClipboardList },
  { label: 'Empresas', Icon: Building2 },
  { label: 'Decisores', Icon: Users },
  { label: 'Cadência', Icon: Workflow },
  { label: 'Revisão', Icon: Check },
] as const;

const input = 'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500';
const label = 'text-xs text-slate-400 mb-1 block';

export default function CampanhaWizard({ campanha, onClose, onSaved }: Props) {
  const edit = !!campanha;
  const [etapa, setEtapa] = useState<Etapa>(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowOpc[]>([]);
  const [baseLeads, setBaseLeads] = useState<number | null>(null);

  // Campos (colunas)
  const [nome, setNome] = useState(campanha?.nome ?? '');
  const [tipo, setTipo] = useState(campanha?.tipo ?? 'prospeccao');
  const [objetivo, setObjetivo] = useState(campanha?.descricao ?? '');
  const [meta, setMeta] = useState(campanha?.meta_leads != null ? String(campanha.meta_leads) : '');
  const [workflowId, setWorkflowId] = useState(campanha?.workflow_id ?? '');

  // publico jsonb
  const p0 = campanha?.publico ?? {};
  const [idioma, setIdioma] = useState(p0.idioma ?? 'pt-BR');
  const [responsavel, setResponsavel] = useState(p0.responsavel ?? '');
  const [segmento, setSegmento] = useState(p0.empresas?.segmento ?? '');
  const [estado, setEstado] = useState(p0.empresas?.estado ?? '');
  const [cidade, setCidade] = useState(p0.empresas?.cidade ?? '');
  const [limite, setLimite] = useState(p0.empresas?.limite != null ? String(p0.empresas.limite) : '');
  const [cargos, setCargos] = useState(p0.decisores?.cargos ?? '');
  const [senioridade, setSenioridade] = useState(p0.decisores?.senioridade ?? '');
  const [maxPorEmpresa, setMaxPorEmpresa] = useState(p0.decisores?.maxPorEmpresa != null ? String(p0.decisores.maxPorEmpresa) : '');
  const [exigirEmail, setExigirEmail] = useState(p0.decisores?.exigirEmail ?? true);
  const [exigirTelefone, setExigirTelefone] = useState(p0.decisores?.exigirTelefone ?? false);

  useEffect(() => {
    fetch('/api/workflows').then((r) => (r.ok ? r.json() : { workflows: [] }))
      .then((d) => setWorkflows((d.workflows ?? []).map((w: WorkflowOpc) => ({ id: w.id, nome: w.nome, status: w.status }))))
      .catch(() => setWorkflows([]));
    fetch('/api/dashboard/resumo').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.leads === 'number') setBaseLeads(d.leads); })
      .catch(() => {});
  }, []);

  function montarPublico(): Publico {
    return {
      objetivo: objetivo.trim() || undefined,
      responsavel: responsavel.trim() || undefined,
      idioma: idioma || undefined,
      empresas: { fonte: 'base', segmento: segmento.trim() || undefined, estado: estado.trim() || undefined, cidade: cidade.trim() || undefined, limite: limite.trim() ? Number(limite) : undefined },
      decisores: { cargos: cargos.trim() || undefined, senioridade: senioridade.trim() || undefined, maxPorEmpresa: maxPorEmpresa.trim() ? Number(maxPorEmpresa) : undefined, exigirEmail, exigirTelefone },
    };
  }

  async function salvar(ativar: boolean) {
    if (!nome.trim()) { setEtapa(0); setErro('Informe o nome da campanha.'); return; }
    setSalvando(true); setErro(null);
    const body = {
      nome: nome.trim(),
      tipo,
      descricao: objetivo.trim() || null,
      meta_leads: meta.trim() ? Number(meta) : null,
      workflow_id: workflowId || null,
      publico: montarPublico(),
    };
    try {
      let campanhaId = campanha?.id;
      if (edit) {
        const r = await fetch(`/api/campanhas/${campanha!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar');
      } else {
        const r = await fetch('/api/campanhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.erro || 'Falha ao criar');
        campanhaId = d.id;
      }
      // "Criar e ativar": só ativa se houver cadência (workflow) — evita campanha
      // ativa sem motor. Transição validada no repository (rascunho→ativa).
      if (ativar && campanhaId) {
        if (!workflowId) throw new Error('Vincule uma cadência (workflow) para ativar.');
        const r2 = await fetch(`/api/campanhas/${campanhaId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ativa' }) });
        if (!r2.ok) throw new Error((await r2.json())?.erro || 'Falha ao ativar');
      }
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  const podeAvancar = etapa > 0 || nome.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !salvando && onClose()}>
      <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho + passos */}
        <div className="px-6 pt-5 pb-4 border-b border-[#2a3147]">
          <div className="flex items-start justify-between mb-4">
            <h3 className="font-bold text-lg text-slate-100">{edit ? 'Editar campanha' : 'Nova campanha'}</h3>
            <button onClick={() => !salvando && onClose()} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
          </div>
          <div className="flex items-center gap-1">
            {PASSOS.map((s, i) => (
              <div key={s.label} className="flex items-center gap-1 flex-1 last:flex-none">
                <button onClick={() => setEtapa(i as Etapa)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${i === etapa ? 'bg-indigo-500/20 text-indigo-300' : i < etapa ? 'text-slate-300' : 'text-slate-500'}`}>
                  <s.Icon size={13} /> <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < PASSOS.length - 1 && <div className={`h-px flex-1 ${i < etapa ? 'bg-indigo-500/40' : 'bg-[#2a3147]'}`} />}
              </div>
            ))}
          </div>
        </div>

        {/* Corpo */}
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {etapa === 0 && (
            <>
              <div>
                <label className={label}>Nome da campanha *</label>
                <input className={input} value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Prospecção hotelaria Q3" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Tipo</label>
                  <select className={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="prospeccao">Prospecção</option>
                    <option value="renovacao">Renovação</option>
                    <option value="reativacao">Reativação</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Meta de leads</label>
                  <input className={input} value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="numeric" placeholder="Ex.: 200" />
                </div>
              </div>
              <div>
                <label className={label}>Objetivo</label>
                <textarea className={`${input} resize-none h-20`} value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="O que esta campanha busca alcançar?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Responsável</label>
                  <input className={input} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome/e-mail do responsável" />
                </div>
                <div>
                  <label className={label}>Idioma</label>
                  <select className={input} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="en">Inglês</option>
                    <option value="es">Espanhol</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {etapa === 1 && (
            <>
              <div className="flex items-start gap-2 text-xs text-slate-400 bg-[#0f1117] border border-[#2a3147] rounded-lg p-3">
                <Info size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                <span>Fonte: <b className="text-slate-200">base de leads existente</b>. Não há integração externa de captura configurada neste ambiente. Os filtros abaixo são aplicados pelo motor na ativação.
                {baseLeads != null && <> Base atual: <b className="text-slate-200">{baseLeads} leads</b>.</>}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Segmento</label><input className={input} value={segmento} onChange={(e) => setSegmento(e.target.value)} placeholder="Ex.: Hotelaria" /></div>
                <div><label className={label}>Limite de empresas</label><input className={input} value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" placeholder="Ex.: 100" /></div>
                <div><label className={label}>Estado</label><input className={input} value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Ex.: RJ" /></div>
                <div><label className={label}>Cidade</label><input className={input} value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Niterói" /></div>
              </div>
            </>
          )}

          {etapa === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Cargos-alvo</label><input className={input} value={cargos} onChange={(e) => setCargos(e.target.value)} placeholder="Ex.: Diretor, Gerente de compras" /></div>
                <div><label className={label}>Senioridade</label><input className={input} value={senioridade} onChange={(e) => setSenioridade(e.target.value)} placeholder="Ex.: C-level, Gerência" /></div>
                <div><label className={label}>Máx. decisores por empresa</label><input className={input} value={maxPorEmpresa} onChange={(e) => setMaxPorEmpresa(e.target.value)} inputMode="numeric" placeholder="Ex.: 2" /></div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={exigirEmail} onChange={(e) => setExigirEmail(e.target.checked)} /> Exigir e-mail válido</label>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={exigirTelefone} onChange={(e) => setExigirTelefone(e.target.checked)} /> Exigir telefone</label>
              </div>
            </>
          )}

          {etapa === 3 && (
            <>
              <label className={label}>Cadência (workflow que executa a campanha)</label>
              {workflows.length === 0 ? (
                <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a3147] rounded-lg p-4">
                  Nenhum workflow disponível. Crie um na aba Workflows e volte para vincular.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto">
                  {workflows.map((w) => (
                    <label key={w.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${workflowId === w.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-[#2a3147] hover:bg-[#0f1117]'}`}>
                      <input type="radio" name="wf" checked={workflowId === w.id} onChange={() => setWorkflowId(w.id)} />
                      <Workflow size={15} className="text-indigo-400" />
                      <span className="text-sm text-slate-200 flex-1">{w.nome}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-400">{w.status}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-600">A campanha reusa o motor de Workflows — sem cadência própria paralela.</p>
            </>
          )}

          {etapa === 4 && (
            <div className="space-y-3 text-sm">
              <Resumo label="Nome" valor={nome || '—'} />
              <Resumo label="Tipo" valor={tipo} />
              <Resumo label="Objetivo" valor={objetivo || '—'} />
              <Resumo label="Meta de leads" valor={meta || '—'} />
              <Resumo label="Empresas" valor={[segmento, estado, cidade].filter(Boolean).join(' · ') || 'Base existente (sem filtro)'} />
              <Resumo label="Decisores" valor={[cargos, senioridade].filter(Boolean).join(' · ') || 'Qualquer'} />
              <Resumo label="Cadência" valor={workflows.find((w) => w.id === workflowId)?.nome ?? '— (sem workflow)'} />
              <Resumo label="Público estimado" valor={baseLeads != null ? `base de ${baseLeads} leads (recorte final no motor)` : 'não calculável'} />
              {!workflowId && <div className="text-xs text-amber-400">Sem cadência vinculada: dá pra salvar rascunho, mas não ativar.</div>}
            </div>
          )}

          {erro && <div className="text-sm text-red-400">{erro}</div>}
        </div>

        {/* Rodapé */}
        <div className="px-6 py-4 border-t border-[#2a3147] flex items-center justify-between">
          <button onClick={() => setEtapa((e) => Math.max(0, e - 1) as Etapa)} disabled={etapa === 0 || salvando}
            className="text-sm px-3 py-2 rounded-lg text-slate-300 hover:bg-[#0f1117] disabled:opacity-30 inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Voltar
          </button>
          <div className="flex items-center gap-2">
            {etapa < 4 ? (
              <button onClick={() => setEtapa((e) => Math.min(4, e + 1) as Etapa)} disabled={!podeAvancar}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
                Avançar <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <button onClick={() => salvar(false)} disabled={salvando}
                  className="text-sm px-4 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] disabled:opacity-40 inline-flex items-center gap-1">
                  {salvando && <Loader2 size={14} className="animate-spin" />} Salvar rascunho
                </button>
                <button onClick={() => salvar(true)} disabled={salvando || !workflowId}
                  title={!workflowId ? 'Vincule uma cadência para ativar' : undefined}
                  className="text-sm px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500 disabled:opacity-40 inline-flex items-center gap-1">
                  {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Criar e ativar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Resumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[#2a3147] pb-2">
      <span className="text-slate-500 w-36 shrink-0">{label}</span>
      <span className="text-slate-200">{valor}</span>
    </div>
  );
}
