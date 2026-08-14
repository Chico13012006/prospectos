'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Target, Users, Workflow, Calendar, CheckCircle2, ArrowLeft, ArrowRight,
  Loader2, Save, Info, Lock, ChevronRight, Check, AlertTriangle,
  Mail, MessageSquare, Phone, Clock, ToggleLeft, ToggleRight,
} from 'lucide-react';
import type { Campanha, Publico } from './tiposCampanha';
import { acharBlocoDef } from '@/lib/workflows/catalogo';

// Wizard de campanha — 5 etapas conforme spec Fase 2:
//   0. Objetivo e nome
//   1. Público e filtros
//   2. Seleção ou criação do workflow/cadência
//   3. Agenda, limites e regras
//   4. Revisão e publicação

interface WorkflowOpc { id: string; nome: string; status: string; etapas?: number; gatilho_tipo?: string | null }
interface PassoCadencia { tipo: string; label: string; icon: 'email' | 'whatsapp' | 'phone' | 'wait' | 'task' }

const PASSOS = [
  { label: 'Objetivo e nome', Icon: Target },
  { label: 'Público e filtros', Icon: Users },
  { label: 'Workflow / cadência', Icon: Workflow },
  { label: 'Agenda e regras', Icon: Calendar },
  { label: 'Revisão e publicação', Icon: CheckCircle2 },
] as const;
type Etapa = 0 | 1 | 2 | 3 | 4;

const DIAS_SEMANA = [
  { id: 'seg', label: 'Seg' }, { id: 'ter', label: 'Ter' }, { id: 'qua', label: 'Qua' },
  { id: 'qui', label: 'Qui' }, { id: 'sex', label: 'Sex' }, { id: 'sab', label: 'Sáb' }, { id: 'dom', label: 'Dom' },
];

const input = 'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500';
const lbl = 'text-xs text-slate-400 mb-1 block';
const card = 'bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5';

function ToggleBtn({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => set(!on)} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors"
      style={on ? { borderColor: 'rgba(99,102,241,0.5)', background: 'rgba(99,102,241,0.1)', color: '#c7d2fe' } : { borderColor: '#2a3147', color: '#94a3b8' }}>
      <span className={`w-8 h-4 rounded-full relative transition-colors ${on ? 'bg-indigo-500' : 'bg-[#2a3147]'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function PassoIcon({ icon }: { icon: PassoCadencia['icon'] }) {
  if (icon === 'email') return <Mail size={14} className="text-indigo-400" />;
  if (icon === 'whatsapp') return <MessageSquare size={14} className="text-green-400" />;
  if (icon === 'phone') return <Phone size={14} className="text-sky-400" />;
  if (icon === 'wait') return <Clock size={14} className="text-slate-400" />;
  return <CheckCircle2 size={14} className="text-amber-400" />;
}

function iconPorTipo(tipo: string): PassoCadencia['icon'] {
  if (tipo === 'enviar_email') return 'email';
  if (tipo === 'enviar_whatsapp') return 'whatsapp';
  if (tipo === 'criar_tarefa_ligacao' || tipo === 'criar_tarefa') return 'task';
  if (tipo === 'esperar') return 'wait';
  return 'task';
}

export default function CampanhaWizardPage({ campanha }: { campanha?: Campanha | null }) {
  const router = useRouter();
  const edit = !!campanha;
  const [etapa, setEtapa] = useState<Etapa>(0);
  const [salvando, setSalvando] = useState<false | 'rascunho' | 'criar'>(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOpc[]>([]);
  const [baseLeads, setBaseLeads] = useState<number | null>(null);
  const [wfPassos, setWfPassos] = useState<PassoCadencia[]>([]);
  const [wfCarregando, setWfCarregando] = useState(false);

  const p0: Publico = campanha?.publico ?? {};

  // --- Etapa 0: Objetivo e nome ---
  const [nome, setNome] = useState(campanha?.nome ?? '');
  const [tipo, setTipo] = useState(campanha?.tipo ?? 'prospeccao');
  const [objetivo, setObjetivo] = useState(campanha?.descricao ?? '');
  const [meta, setMeta] = useState(campanha?.meta_leads != null ? String(campanha.meta_leads) : '');
  const [responsavelId, setResponsavelId] = useState(p0.responsavel_id ?? '');
  const [prazo, setPrazo] = useState(p0.prazo ?? '');
  const [membros, setMembros] = useState<{ id: string; nome: string; email: string }[]>([]);

  // --- Etapa 1: Público e filtros ---
  const [segmento, setSegmento] = useState(p0.empresas?.segmento ?? '');
  const [cidades, setCidades] = useState(p0.empresas?.cidades ?? '');
  const [pais, setPais] = useState(p0.empresas?.pais ?? '');
  const [limite, setLimite] = useState(p0.empresas?.limite != null ? String(p0.empresas.limite) : '');
  const [removerDup, setRemoverDup] = useState(p0.empresas?.removerDuplicados ?? true);
  const [exigirSite, setExigirSite] = useState(p0.empresas?.exigirSite ?? false);
  const [departamento, setDepartamento] = useState(p0.decisores?.departamento ?? '');
  const [cargos, setCargos] = useState(p0.decisores?.cargos ?? '');
  const [senioridade, setSenioridade] = useState(p0.decisores?.senioridade ?? '');
  const [exigirEmail, setExigirEmail] = useState(p0.decisores?.exigirEmail ?? true);
  const [exigirTelefone, setExigirTelefone] = useState(p0.decisores?.exigirTelefone ?? false);
  const [idioma, setIdioma] = useState(p0.idioma ?? 'pt-BR');

  // --- Etapa 2: Workflow/cadência ---
  const [workflowId, setWorkflowId] = useState(campanha?.workflow_id ?? '');

  // --- Etapa 3: Agenda e regras ---
  const ag = p0.agenda ?? {};
  const [diasSemana, setDiasSemana] = useState<string[]>(ag.diasSemana ?? ['seg', 'ter', 'qua', 'qui', 'sex']);
  const [horarioInicio, setHorarioInicio] = useState(ag.horarioInicio ?? '09:00');
  const [horarioFim, setHorarioFim] = useState(ag.horarioFim ?? '18:00');
  const [limiteDiario, setLimiteDiario] = useState(ag.limiteDiario != null ? String(ag.limiteDiario) : '');
  const [pararAoResponder, setPararAoResponder] = useState(ag.pararAoResponder ?? true);

  useEffect(() => {
    fetch('/api/workflows').then((r) => (r.ok ? r.json() : { workflows: [] }))
      .then((d) => setWorkflows((d.workflows ?? []).map((w: WorkflowOpc) => ({
        id: w.id, nome: w.nome, status: w.status, etapas: w.etapas, gatilho_tipo: w.gatilho_tipo,
      }))))
      .catch(() => {});
    fetch('/api/dashboard/resumo').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.leads === 'number') setBaseLeads(d.leads); })
      .catch(() => {});
    fetch('/api/equipe/listar').then((r) => (r.ok ? r.json() : { membros: [] }))
      .then((d) => setMembros((d.membros ?? []).filter((m: { nome: string; email: string }) => m.nome || m.email)))
      .catch(() => {});
  }, []);

  // Ao selecionar workflow, busca os passos para preview
  useEffect(() => {
    if (!workflowId) { setWfPassos([]); return; }
    setWfCarregando(true);
    fetch(`/api/workflows/${workflowId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.workflow) return;
        const def = d.workflow.rascunho_definicao ?? (d.versoes?.[0]?.definicao ?? null);
        if (!def?.acoes) { setWfPassos([]); return; }
        const passos: PassoCadencia[] = (def.acoes as Array<{ tipo: string; config: Record<string, unknown> }>).map((a) => {
          const bl = acharBlocoDef(a.tipo);
          const label = bl?.label ?? a.tipo;
          const icon = iconPorTipo(a.tipo);
          return { tipo: a.tipo, label, icon };
        });
        setWfPassos(passos);
      })
      .catch(() => setWfPassos([]))
      .finally(() => setWfCarregando(false));
  }, [workflowId]);

  function montarBody() {
    const publico: Publico = {
      objetivo: objetivo.trim() || undefined,
      responsavel_id: responsavelId || undefined,
      idioma: idioma || undefined,
      prazo: prazo || undefined,
      empresas: {
        fonte: 'base',
        pais: pais.trim() || undefined,
        segmento: segmento.trim() || undefined,
        cidades: cidades.trim() || undefined,
        limite: limite.trim() ? Number(limite) : undefined,
        removerDuplicados: removerDup,
        exigirSite,
      },
      decisores: {
        departamento: departamento.trim() || undefined,
        cargos: cargos.trim() || undefined,
        senioridade: senioridade.trim() || undefined,
        exigirEmail,
        exigirTelefone,
      },
      agenda: {
        diasSemana,
        horarioInicio: horarioInicio || '09:00',
        horarioFim: horarioFim || '18:00',
        limiteDiario: limiteDiario.trim() ? Number(limiteDiario) : undefined,
        pararAoResponder,
      },
    };
    return {
      nome: nome.trim(),
      tipo,
      descricao: objetivo.trim() || null,
      meta_leads: meta.trim() ? Number(meta) : null,
      workflow_id: workflowId || null,
      publico,
    };
  }

  async function salvar(modo: 'rascunho' | 'criar') {
    if (!nome.trim()) { setEtapa(0); setErro('Informe o nome da campanha.'); return; }
    setSalvando(modo); setErro(null); setOk(false);
    try {
      const body = montarBody();
      let id = campanha?.id;
      if (edit) {
        const r = await fetch(`/api/campanhas/${campanha!.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar');
      } else {
        const r = await fetch('/api/campanhas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.erro || 'Falha ao criar');
        id = d.id;
      }
      if (modo === 'criar' && id) {
        router.push(`/automacao/campanhas/${id}`);
        return;
      }
      setOk(true); setTimeout(() => setOk(false), 2500);
      setSalvando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  const wfSelecionado = workflows.find((w) => w.id === workflowId);
  const cadenciaNome = wfSelecionado?.nome;
  const wfNaoPublicado = wfSelecionado != null && wfSelecionado.status !== 'publicado';
  const podeAvancar = nome.trim().length > 0 && !(etapa === 2 && wfNaoPublicado);

  function toggleDia(dia: string) {
    setDiasSemana((prev) => prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]);
  }

  return (
    <div className="p-6 max-w-[100rem] mx-auto">
      {/* Cabeçalho + ações */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
            <Link href="/automacao?tab=campanhas" className="hover:text-slate-300">Campanhas</Link>
            <ChevronRight size={12} />
            <span className="text-slate-400">{edit ? 'Editar' : 'Nova campanha'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{edit ? (nome || 'Editar campanha') : 'Nova campanha'}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ok && <span className="text-xs text-green-400 inline-flex items-center gap-1"><Check size={13} /> salvo</span>}
          <button onClick={() => salvar('rascunho')} disabled={!!salvando}
            className="text-sm px-4 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] disabled:opacity-40 inline-flex items-center gap-1">
            {salvando === 'rascunho' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar rascunho
          </button>
          <button onClick={() => salvar('criar')} disabled={!!salvando}
            className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
            {salvando === 'criar' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {edit ? 'Salvar campanha' : 'Criar campanha'}
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto">
        {PASSOS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1 flex-1 last:flex-none min-w-0">
            <button onClick={() => setEtapa(i as Etapa)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                i === etapa ? 'bg-indigo-500/20 text-indigo-300' : i < etapa ? 'text-slate-300 hover:text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}>
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] shrink-0 ${
                i === etapa ? 'bg-indigo-500 text-white' : i < etapa ? 'bg-green-600/30 text-green-300' : 'bg-[#2a3147] text-slate-400'
              }`}>
                {i < etapa ? <Check size={11} /> : i + 1}
              </span>
              <span className="hidden md:inline">{s.label}</span>
            </button>
            {i < PASSOS.length - 1 && (
              <div className={`h-px flex-1 min-w-[12px] ${i < etapa ? 'bg-green-600/40' : 'bg-[#2a3147]'}`} />
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Conteúdo por etapa */}
        <div className="space-y-5">
          {/* Etapa 0: Objetivo e nome */}
          {etapa === 0 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                <Target size={16} className="text-indigo-400" /> Objetivo e nome
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={lbl}>Nome da campanha *</label>
                  <input className={input} value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Reativação Laudos Q3" />
                </div>
                <div>
                  <label className={lbl}>Tipo de campanha</label>
                  <select className={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="prospeccao">Prospecção</option>
                    <option value="renovacao">Renovação</option>
                    <option value="reativacao">Reativação</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Objetivo</label>
                  <input className={input} value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: Renovar laudos vencidos no trimestre" />
                </div>
                <div>
                  <label className={lbl}>Responsável</label>
                  <select className={input} value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
                    <option value="">— selecione —</option>
                    {membros.map((m) => (
                      <option key={m.id} value={m.id}>{m.nome || m.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Meta de contatos</label>
                  <input className={input} value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="numeric" placeholder="Ex.: 200" />
                </div>
                <div>
                  <label className={lbl}>Prazo</label>
                  <input className={input} type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Idioma</label>
                  <select className={input} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                    <option value="pt-BR">Português (BR)</option>
                    <option value="es">Espanhol</option>
                    <option value="en">Inglês</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Etapa 1: Público e filtros */}
          {etapa === 1 && (
            <div className="space-y-4">
              <div className={card}>
                <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <Users size={16} className="text-indigo-400" /> Empresas
                </h2>
                <label className={lbl}>Fonte</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-indigo-500/50 bg-indigo-500/10 text-sm text-indigo-200">
                    <input type="radio" checked readOnly /> Base de leads existente
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 ml-auto">conectada</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-[#2a3147] text-sm text-slate-500" title="Integração externa não configurada">
                    <input type="radio" disabled /> <Lock size={13} /> Google Maps Extractor
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-500 ml-auto">não configurado</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={lbl}>Segmento</label><input className={input} value={segmento} onChange={(e) => setSegmento(e.target.value)} placeholder="Ex.: Hotelaria, Laudos" /></div>
                  <div><label className={lbl}>País</label><input className={input} value={pais} onChange={(e) => setPais(e.target.value)} placeholder="Ex.: Brasil" /></div>
                  <div><label className={lbl}>Cidades / regiões</label><input className={input} value={cidades} onChange={(e) => setCidades(e.target.value)} placeholder="Ex.: RJ, Niterói" /></div>
                  <div><label className={lbl}>Limite de contatos</label><input className={input} value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" placeholder="Ex.: 200" /></div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={removerDup} onChange={(e) => setRemoverDup(e.target.checked)} className="accent-indigo-500" /> Remover duplicados
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={exigirSite} onChange={(e) => setExigirSite(e.target.checked)} className="accent-indigo-500" /> Exigir site ativo
                  </label>
                </div>
                <div className="flex items-start gap-2 text-xs text-slate-500 mt-4 bg-[#0f1117] border border-[#2a3147] rounded-lg p-3">
                  <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                  <span>Filtros aplicados pelo motor ao ativar. {baseLeads != null && <>Base atual: <b className="text-slate-300">{baseLeads} leads</b>.</>}</span>
                </div>
              </div>

              <div className={card}>
                <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <Users size={16} className="text-indigo-400" /> Decisor ideal
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={lbl}>Departamento</label><input className={input} value={departamento} onChange={(e) => setDepartamento(e.target.value)} placeholder="Ex.: Compras, Operações" /></div>
                  <div><label className={lbl}>Cargos-alvo</label><input className={input} value={cargos} onChange={(e) => setCargos(e.target.value)} placeholder="Ex.: Diretor, Gerente" /></div>
                  <div><label className={lbl}>Senioridade</label><input className={input} value={senioridade} onChange={(e) => setSenioridade(e.target.value)} placeholder="Ex.: C-level, Gerência" /></div>
                </div>
                <div className="flex flex-wrap gap-4 mt-4">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={exigirEmail} onChange={(e) => setExigirEmail(e.target.checked)} className="accent-indigo-500" /> Exigir e-mail validado
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={exigirTelefone} onChange={(e) => setExigirTelefone(e.target.checked)} className="accent-indigo-500" /> Exigir telefone / WhatsApp
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Etapa 2: Seleção ou criação do workflow/cadência */}
          {etapa === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
              {/* Seleção de workflow */}
              <div className={card}>
                <h2 className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
                  <Workflow size={16} className="text-indigo-400" /> Configure a cadência
                </h2>
                <p className="text-xs text-slate-500 mb-4">Selecione o workflow que executa a cadência desta campanha. O motor de Workflows é a única implementação — nunca duplicamos a lógica.</p>

                {workflows.length === 0 ? (
                  <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a3147] rounded-lg p-4">
                    Nenhum workflow disponível.{' '}
                    <Link href="/automacao?tab=workflows" className="text-indigo-300 hover:text-indigo-200">Crie um na aba Workflows</Link> e volte para vincular.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-auto mb-4">
                    {workflows.map((w) => (
                      <label key={w.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${workflowId === w.id ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-[#2a3147] hover:bg-[#0f1117]'}`}>
                        <input type="radio" name="wf" checked={workflowId === w.id} onChange={() => setWorkflowId(w.id)} />
                        <Workflow size={15} className="text-indigo-400 shrink-0" />
                        <span className="text-sm text-slate-200 flex-1 min-w-0 truncate">{w.nome}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-400 shrink-0">{w.status}</span>
                        {w.etapas != null && <span className="text-[10px] text-slate-500 shrink-0">{w.etapas} etapas</span>}
                      </label>
                    ))}
                  </div>
                )}

                {/* Preview dos passos do workflow selecionado */}
                {workflowId && (
                  <div className="border-t border-[#2a3147] pt-4 mt-2">
                    <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-3">Passos da cadência</h3>
                    {wfCarregando ? (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Loader2 size={13} className="animate-spin" /> Carregando passos...
                      </div>
                    ) : wfPassos.length === 0 ? (
                      <p className="text-xs text-slate-500">Nenhum passo definido neste workflow ainda.</p>
                    ) : (
                      <div className="space-y-2">
                        {wfPassos.map((p, i) => (
                          <div key={i} className="flex items-center gap-3 text-sm text-slate-300">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#252b3b] text-[11px] text-slate-400 shrink-0">{i + 1}</span>
                            <PassoIcon icon={p.icon} />
                            <span className="flex-1">{p.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {wfNaoPublicado && (
                  <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-xs text-amber-300">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    <span>
                      Este workflow está em <strong>{wfSelecionado?.status}</strong> — publique-o antes de avançar.
                      {' '}A campanha só inscreve leads em workflows publicados.{' '}
                      <Link href="/automacao?tab=workflows" className="underline hover:text-amber-200">Abrir Workflows</Link>
                    </span>
                  </div>
                )}
              </div>

              {/* Regras de envio (sidebar) */}
              <div className={`${card} self-start`}>
                <h3 className="font-semibold text-slate-200 text-sm mb-3">Regras de envio</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1.5">Dias da semana</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DIAS_SEMANA.map((d) => (
                        <button key={d.id} type="button" onClick={() => toggleDia(d.id)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${diasSemana.includes(d.id) ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300' : 'border-[#2a3147] text-slate-400 hover:text-slate-200'}`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Horário de envio</label>
                    <div className="flex items-center gap-2">
                      <input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)}
                        className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                      <span className="text-xs text-slate-500">–</span>
                      <input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)}
                        className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Limite diário</label>
                    <input className="w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                      value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value)} inputMode="numeric" placeholder="Sem limite" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Parar ao receber resposta</span>
                    <button type="button" onClick={() => setPararAoResponder(!pararAoResponder)}>
                      {pararAoResponder
                        ? <ToggleRight size={22} className="text-indigo-400" />
                        : <ToggleLeft size={22} className="text-slate-600" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Etapa 3: Agenda, limites e regras */}
          {etapa === 3 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                <Calendar size={16} className="text-indigo-400" /> Agenda, limites e regras
              </h2>
              <div className="space-y-5 max-w-lg">
                <div>
                  <label className={lbl}>Dias da semana para envio</label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {DIAS_SEMANA.map((d) => (
                      <button key={d.id} type="button" onClick={() => toggleDia(d.id)}
                        className={`text-sm px-3 py-2 rounded-lg border transition-colors font-medium ${diasSemana.includes(d.id) ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300' : 'border-[#2a3147] text-slate-400 hover:text-slate-200'}`}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Horário início</label>
                    <input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={lbl}>Horário fim</label>
                    <input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} className={input} />
                  </div>
                </div>
                <div>
                  <label className={lbl}>Limite de envios por dia</label>
                  <input className={input} value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value)} inputMode="numeric" placeholder="Sem limite (deixe vazio)" />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-[#0f1117] border border-[#2a3147]">
                  <div>
                    <div className="text-sm font-medium text-slate-200">Parar ao receber resposta</div>
                    <div className="text-xs text-slate-500 mt-0.5">Encerra a cadência automaticamente quando o lead responde</div>
                  </div>
                  <ToggleBtn on={pararAoResponder} set={setPararAoResponder} />
                </div>
              </div>
            </div>
          )}

          {/* Etapa 4: Revisão e publicação */}
          {etapa === 4 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-indigo-400" /> Revisão e publicação
              </h2>
              <div className="space-y-2 text-sm">
                <Linha k="Nome" v={nome || '—'} />
                <Linha k="Tipo · Objetivo" v={`${tipo}${objetivo ? ' · ' + objetivo : ''}`} />
                <Linha k="Meta / Prazo" v={`${meta || '—'} contatos${prazo ? ' · até ' + prazo : ''}`} />
                <Linha k="Segmento" v={[segmento, cidades, pais].filter(Boolean).join(' · ') || 'Base existente (sem filtro)'} />
                <Linha k="Decisores" v={[departamento, cargos, senioridade].filter(Boolean).join(' · ') || 'Qualquer'} />
                <Linha k="Cadência (workflow)" v={cadenciaNome ?? '— (sem workflow)'} />
                <Linha k="Horário de envio" v={`${diasSemana.join(', ')} · ${horarioInicio}–${horarioFim}`} />
                <Linha k="Limite diário" v={limiteDiario || 'Sem limite'} />
                <Linha k="Parar ao responder" v={pararAoResponder ? 'Sim' : 'Não'} />
                <Linha k="Público estimado" v={baseLeads != null ? `base de ${baseLeads} leads (recorte final no motor)` : 'não calculável'} />
              </div>
              {!workflowId && (
                <div className="text-xs text-amber-400 mt-3 p-3 bg-amber-400/10 rounded-lg border border-amber-400/20">
                  Sem cadência vinculada: pode salvar rascunho, mas a campanha só ativa com um workflow.
                </div>
              )}
            </div>
          )}

          {erro && <div className="text-sm text-red-400">{erro}</div>}

          {/* Navegação */}
          <div className="flex items-center justify-between">
            <button onClick={() => setEtapa((e) => Math.max(0, e - 1) as Etapa)} disabled={etapa === 0}
              className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[#0f1117] disabled:opacity-30 inline-flex items-center gap-1">
              <ArrowLeft size={14} /> Voltar
            </button>
            {etapa < 4 && (
              <button onClick={() => setEtapa((e) => Math.min(4, e + 1) as Etapa)} disabled={!podeAvancar}
                className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
                Avançar <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Sidebar: Resumo da campanha */}
        <div className="space-y-4 lg:sticky lg:top-6 self-start">
          <div className={card}>
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Resumo da campanha</h3>
            <div className="space-y-2 text-xs">
              <Mini k="Nome" v={nome || '—'} />
              <Mini k="Tipo" v={tipo} />
              <Mini k="Objetivo" v={objetivo || '—'} />
              <Mini k="Segmento" v={segmento || 'Base existente'} />
              <Mini k="Cadência" v={cadenciaNome ?? '—'} />
              {wfSelecionado && <Mini k="Gatilho" v={wfSelecionado.gatilho_tipo ? (acharBlocoDef(wfSelecionado.gatilho_tipo)?.label ?? wfSelecionado.gatilho_tipo) : 'Não definido'} />}
              <Mini k="Envio" v={diasSemana.length > 0 ? `${diasSemana.join(', ')} ${horarioInicio}–${horarioFim}` : 'Sem agenda'} />
            </div>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Estimativa de uso</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[#0f1117] border border-[#2a3147] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Base atual</div>
                <div className="text-lg font-bold text-slate-100">{baseLeads ?? '—'}</div>
              </div>
              <div className="rounded-lg bg-[#0f1117] border border-[#2a3147] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Limite</div>
                <div className="text-lg font-bold text-slate-100">{limite || '—'}</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-600 mt-3">O consumo real depende do recorte que o motor aplicar na ativação.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[#2a3147] pb-2">
      <span className="text-slate-500 w-44 shrink-0">{k}</span>
      <span className="text-slate-200">{v}</span>
    </div>
  );
}
function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 w-20 shrink-0">{k}</span>
      <span className="text-slate-300 truncate">{v}</span>
    </div>
  );
}
