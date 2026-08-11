'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList, Building2, Users, Workflow, Check, ArrowLeft, ArrowRight,
  Loader2, Save, Info, Lock, ChevronRight,
} from 'lucide-react';
import type { Campanha, Publico } from './tiposCampanha';

// Wizard de campanha em PÁGINA PRÓPRIA (modal foi rejeitado). Estado único no
// componente → voltar/avançar nunca perde o digitado. Persiste DE VERDADE em
// `campanhas` (POST /api/campanhas ou PATCH /api/campanhas/[id]): colunas +
// `publico` jsonb + `workflow_id`. Honestidade: a única fonte de empresas real
// é a BASE de leads existente; não há extractor externo configurado no repo, então
// essa opção fica travada. Público final é resolvido pelo motor (Workflows).

interface WorkflowOpc { id: string; nome: string; status: string }

const PASSOS = [
  { label: 'Visão geral', Icon: ClipboardList },
  { label: 'Empresas', Icon: Building2 },
  { label: 'Decisores', Icon: Users },
  { label: 'Cadência', Icon: Workflow },
  { label: 'Revisão', Icon: Check },
] as const;
type Etapa = 0 | 1 | 2 | 3 | 4;

const input = 'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500';
const lbl = 'text-xs text-slate-400 mb-1 block';
const card = 'bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5';

function Toggle({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => set(!on)}
      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors ${on ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200' : 'border-[#2a3147] text-slate-400 hover:text-slate-200'}`}>
      <span className={`w-8 h-4 rounded-full relative transition-colors ${on ? 'bg-indigo-500' : 'bg-[#2a3147]'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`} />
      </span>
      {children}
    </button>
  );
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

  const p0: Publico = campanha?.publico ?? {};
  // colunas
  const [nome, setNome] = useState(campanha?.nome ?? '');
  const [tipo, setTipo] = useState(campanha?.tipo ?? 'prospeccao');
  const [objetivo, setObjetivo] = useState(campanha?.descricao ?? '');
  const [meta, setMeta] = useState(campanha?.meta_leads != null ? String(campanha.meta_leads) : '');
  const [workflowId, setWorkflowId] = useState(campanha?.workflow_id ?? '');
  // publico
  const [responsavel, setResponsavel] = useState(p0.responsavel ?? '');
  const [idioma, setIdioma] = useState(p0.idioma ?? 'pt-BR');
  const [prazo, setPrazo] = useState(p0.prazo ?? '');
  const [pais, setPais] = useState(p0.empresas?.pais ?? '');
  const [segmento, setSegmento] = useState(p0.empresas?.segmento ?? '');
  const [cidades, setCidades] = useState(p0.empresas?.cidades ?? '');
  const [limite, setLimite] = useState(p0.empresas?.limite != null ? String(p0.empresas.limite) : '');
  const [removerDup, setRemoverDup] = useState(p0.empresas?.removerDuplicados ?? true);
  const [exigirSite, setExigirSite] = useState(p0.empresas?.exigirSite ?? false);
  const [departamento, setDepartamento] = useState(p0.decisores?.departamento ?? '');
  const [cargos, setCargos] = useState(p0.decisores?.cargos ?? '');
  const [senioridade, setSenioridade] = useState(p0.decisores?.senioridade ?? '');
  const [maxPorEmpresa, setMaxPorEmpresa] = useState(p0.decisores?.maxPorEmpresa != null ? String(p0.decisores.maxPorEmpresa) : '');
  const [exigirEmail, setExigirEmail] = useState(p0.decisores?.exigirEmail ?? true);
  const [exigirTelefone, setExigirTelefone] = useState(p0.decisores?.exigirTelefone ?? false);

  useEffect(() => {
    fetch('/api/workflows').then((r) => (r.ok ? r.json() : { workflows: [] }))
      .then((d) => setWorkflows((d.workflows ?? []).map((w: WorkflowOpc) => ({ id: w.id, nome: w.nome, status: w.status }))))
      .catch(() => {});
    fetch('/api/dashboard/resumo').then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.leads === 'number') setBaseLeads(d.leads); })
      .catch(() => {});
  }, []);

  function montarBody() {
    const publico: Publico = {
      objetivo: objetivo.trim() || undefined,
      responsavel: responsavel.trim() || undefined,
      idioma: idioma || undefined,
      prazo: prazo || undefined,
      empresas: { fonte: 'base', pais: pais.trim() || undefined, segmento: segmento.trim() || undefined, cidades: cidades.trim() || undefined, limite: limite.trim() ? Number(limite) : undefined, removerDuplicados: removerDup, exigirSite },
      decisores: { departamento: departamento.trim() || undefined, cargos: cargos.trim() || undefined, senioridade: senioridade.trim() || undefined, maxPorEmpresa: maxPorEmpresa.trim() ? Number(maxPorEmpresa) : undefined, exigirEmail, exigirTelefone },
    };
    return { nome: nome.trim(), tipo, descricao: objetivo.trim() || null, meta_leads: meta.trim() ? Number(meta) : null, workflow_id: workflowId || null, publico };
  }

  async function salvar(modo: 'rascunho' | 'criar') {
    if (!nome.trim()) { setEtapa(0); setErro('Informe o nome da campanha.'); return; }
    setSalvando(modo); setErro(null); setOk(false);
    try {
      const body = montarBody();
      let id = campanha?.id;
      if (edit) {
        const r = await fetch(`/api/campanhas/${campanha!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json())?.erro || 'Falha ao salvar');
      } else {
        const r = await fetch('/api/campanhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

  const podeAvancar = nome.trim().length > 0;
  const cadenciaNome = workflows.find((w) => w.id === workflowId)?.nome;

  return (
    <div className="p-6 max-w-[100rem] mx-auto">
      {/* Cabeçalho + ações */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
            <Link href="/automacao?tab=campanhas" className="hover:text-slate-300">Campanhas</Link>
            <ChevronRight size={12} /> <span className="text-slate-400">{edit ? 'Editar' : 'Nova campanha'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{edit ? (nome || 'Editar campanha') : 'Nova campanha'}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ok && <span className="text-xs text-green-400 inline-flex items-center gap-1"><Check size={13} /> salvo</span>}
          <button disabled title="Integração de busca externa não configurada neste ambiente"
            className="text-sm px-3 py-2 rounded-lg border border-[#2a3147] text-slate-500 opacity-50 cursor-not-allowed inline-flex items-center gap-1">
            <Lock size={13} /> Testar busca
          </button>
          <button onClick={() => salvar('rascunho')} disabled={!!salvando}
            className="text-sm px-4 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] disabled:opacity-40 inline-flex items-center gap-1">
            {salvando === 'rascunho' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar rascunho
          </button>
          <button onClick={() => salvar('criar')} disabled={!!salvando}
            className="text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1">
            {salvando === 'criar' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {edit ? 'Salvar campanha' : 'Criar campanha'}
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 mb-5">
        {PASSOS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1 flex-1 last:flex-none">
            <button onClick={() => setEtapa(i as Etapa)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${i === etapa ? 'bg-indigo-500/20 text-indigo-300' : i < etapa ? 'text-slate-300 hover:text-slate-100' : 'text-slate-500 hover:text-slate-300'}`}>
              <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${i === etapa ? 'bg-indigo-500 text-white' : i < etapa ? 'bg-green-600/30 text-green-300' : 'bg-[#2a3147] text-slate-400'}`}>
                {i < etapa ? <Check size={11} /> : i + 1}
              </span>
              <span className="hidden md:inline">{s.label}</span>
            </button>
            {i < PASSOS.length - 1 && <div className={`h-px flex-1 ${i < etapa ? 'bg-green-600/40' : 'bg-[#2a3147]'}`} />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Formulário (por etapa) */}
        <div className="space-y-5">
          {etapa === 0 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2"><ClipboardList size={16} className="text-indigo-400" /> Dados da campanha</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2"><label className={lbl}>Nome da campanha *</label><input className={input} value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Missão República Dominicana" /></div>
                <div><label className={lbl}>Tipo</label>
                  <select className={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="prospeccao">Prospecção</option><option value="renovacao">Renovação</option><option value="reativacao">Reativação</option><option value="outro">Outro</option>
                  </select>
                </div>
                <div><label className={lbl}>Objetivo</label><input className={input} value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: Agendar visitas presenciais" /></div>
                <div><label className={lbl}>Responsável</label><input className={input} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome/e-mail" /></div>
                <div><label className={lbl}>Meta de leads</label><input className={input} value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="numeric" placeholder="Ex.: 200" /></div>
                <div><label className={lbl}>Prazo</label><input className={input} type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></div>
                <div><label className={lbl}>Idioma</label>
                  <select className={input} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                    <option value="pt-BR">Português (BR)</option><option value="es">Espanhol</option><option value="en">Inglês</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {etapa === 1 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2"><Building2 size={16} className="text-indigo-400" /> Encontrar empresas</h2>
              <label className={lbl}>Fonte</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                <div className="flex items-center gap-2 p-3 rounded-lg border border-indigo-500/50 bg-indigo-500/10 text-sm text-indigo-200">
                  <input type="radio" checked readOnly /> Base de leads existente <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 ml-auto">conectada</span>
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg border border-[#2a3147] text-sm text-slate-500" title="Integração externa não configurada neste ambiente">
                  <input type="radio" disabled /> <Lock size={13} /> Google Maps Extractor <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#252b3b] text-slate-500 ml-auto">não configurado</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={lbl}>País</label><input className={input} value={pais} onChange={(e) => setPais(e.target.value)} placeholder="Ex.: Brasil" /></div>
                <div><label className={lbl}>Limite de empresas</label><input className={input} value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" placeholder="Ex.: 200" /></div>
                <div><label className={lbl}>Segmentos</label><input className={input} value={segmento} onChange={(e) => setSegmento(e.target.value)} placeholder="Ex.: Hotelaria, Turismo" /></div>
                <div><label className={lbl}>Cidades / regiões</label><input className={input} value={cidades} onChange={(e) => setCidades(e.target.value)} placeholder="Ex.: RJ, Niterói" /></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Toggle on={removerDup} set={setRemoverDup}>Remover duplicados</Toggle>
                <Toggle on={exigirSite} set={setExigirSite}>Exigir site ativo</Toggle>
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-500 mt-4 bg-[#0f1117] border border-[#2a3147] rounded-lg p-3">
                <Info size={13} className="text-indigo-400 shrink-0 mt-0.5" />
                <span>Os filtros são aplicados pelo motor (Workflows) sobre a base ao ativar. {baseLeads != null && <>Base atual: <b className="text-slate-300">{baseLeads} leads</b>.</>}</span>
              </div>
            </div>
          )}

          {etapa === 2 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2"><Users size={16} className="text-indigo-400" /> Decisor ideal</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={lbl}>Departamento</label><input className={input} value={departamento} onChange={(e) => setDepartamento(e.target.value)} placeholder="Ex.: Compras, Operações" /></div>
                <div><label className={lbl}>Cargos-alvo</label><input className={input} value={cargos} onChange={(e) => setCargos(e.target.value)} placeholder="Ex.: Diretor, Gerente" /></div>
                <div><label className={lbl}>Senioridade</label><input className={input} value={senioridade} onChange={(e) => setSenioridade(e.target.value)} placeholder="Ex.: C-level, Gerência" /></div>
                <div><label className={lbl}>Máx. decisores por empresa</label><input className={input} value={maxPorEmpresa} onChange={(e) => setMaxPorEmpresa(e.target.value)} inputMode="numeric" placeholder="Ex.: 2" /></div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Toggle on={exigirEmail} set={setExigirEmail}>Exigir e-mail validado</Toggle>
                <Toggle on={exigirTelefone} set={setExigirTelefone}>Exigir telefone / WhatsApp</Toggle>
              </div>
            </div>
          )}

          {etapa === 3 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2"><Workflow size={16} className="text-indigo-400" /> Cadência</h2>
              <p className="text-xs text-slate-500 mb-3">A campanha reusa o motor de Workflows — escolha o workflow que executa a cadência.</p>
              {workflows.length === 0 ? (
                <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a3147] rounded-lg p-4">
                  Nenhum workflow disponível. <Link href="/automacao?tab=workflows" className="text-indigo-300 hover:text-indigo-200">Crie um na aba Workflows</Link> e volte para vincular.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-auto">
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
            </div>
          )}

          {etapa === 4 && (
            <div className={card}>
              <h2 className="font-semibold text-slate-200 mb-4 flex items-center gap-2"><Check size={16} className="text-indigo-400" /> Revisão</h2>
              <div className="space-y-2 text-sm">
                <Linha k="Nome" v={nome || '—'} />
                <Linha k="Tipo · Objetivo" v={`${tipo}${objetivo ? ' · ' + objetivo : ''}`} />
                <Linha k="Meta / Prazo" v={`${meta || '—'} leads${prazo ? ' · até ' + prazo : ''}`} />
                <Linha k="Empresas" v={[segmento, cidades, pais].filter(Boolean).join(' · ') || 'Base existente (sem filtro)'} />
                <Linha k="Decisores" v={[departamento, cargos, senioridade].filter(Boolean).join(' · ') || 'Qualquer'} />
                <Linha k="Cadência" v={cadenciaNome ?? '— (sem workflow)'} />
                <Linha k="Público estimado" v={baseLeads != null ? `base de ${baseLeads} leads (recorte final no motor)` : 'não calculável'} />
              </div>
              {!workflowId && <div className="text-xs text-amber-400 mt-3">Sem cadência vinculada: dá pra salvar/criar rascunho, mas a campanha só ativa com um workflow.</div>}
            </div>
          )}

          {erro && <div className="text-sm text-red-400">{erro}</div>}

          {/* Navegação entre etapas */}
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

        {/* Sidebar: Resumo + Estimativa */}
        <div className="space-y-4 lg:sticky lg:top-6 self-start">
          <div className={card}>
            <h3 className="font-semibold text-slate-200 text-sm mb-3">Resumo da campanha</h3>
            <div className="space-y-2 text-xs">
              <Mini k="Nome" v={nome || '—'} />
              <Mini k="Tipo" v={tipo} />
              <Mini k="Objetivo" v={objetivo || '—'} />
              <Mini k="Empresas" v={[segmento, cidades].filter(Boolean).join(' · ') || 'Base existente'} />
              <Mini k="Decisores" v={[cargos, senioridade].filter(Boolean).join(' · ') || 'Qualquer'} />
              <Mini k="Cadência" v={cadenciaNome ?? '—'} />
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
  return <div className="flex items-start gap-3 border-b border-[#2a3147] pb-2"><span className="text-slate-500 w-40 shrink-0">{k}</span><span className="text-slate-200">{v}</span></div>;
}
function Mini({ k, v }: { k: string; v: string }) {
  return <div className="flex items-start gap-2"><span className="text-slate-500 w-20 shrink-0">{k}</span><span className="text-slate-300 truncate">{v}</span></div>;
}
