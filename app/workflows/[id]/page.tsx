'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Zap, Filter, PlayCircle,
  CheckCircle2, PauseCircle, Rocket, Save, AlertTriangle,
} from 'lucide-react';
import type { BlocoConfig, DefinicaoWorkflow, Workflow, WorkflowVersao, StatusWorkflow } from '@/lib/workflows/types';
import {
  ACOES, CONDICOES, GATILHOS, acharBlocoDef, blocoPadrao, configPadrao, definicaoVazia,
  garantirIdsAcoes, type BlocoDef, type CampoDef,
} from '@/lib/workflows/catalogo';
import ResumoFluxo from '@/components/workflows/ResumoFluxo';

const STATUS_INFO: Record<StatusWorkflow, { label: string; classes: string }> = {
  rascunho: { label: 'Rascunho', classes: 'bg-slate-500/20 text-slate-300' },
  publicado: { label: 'Publicado', classes: 'bg-green-500/20 text-green-300' },
  pausado: { label: 'Pausado', classes: 'bg-amber-500/20 text-amber-300' },
};

const EXEC_LABEL: Record<string, string> = {
  em_andamento: 'Em andamento', aguardando: 'Aguardando', concluido: 'Concluídas',
  erro: 'Com erro', cancelado: 'Canceladas',
};

// --- Editor dos campos de config de um bloco (a partir do catálogo) ----------
function CamposEditor({ def, config, onChange }: {
  def: BlocoDef;
  config: Record<string, unknown>;
  onChange: (nome: string, valor: unknown) => void;
}) {
  if (def.campos.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3 mt-2">
      {def.campos.map((campo: CampoDef) => {
        const valor = config[campo.nome];
        return (
          <label key={campo.nome} className="text-xs text-slate-400 flex flex-col gap-1">
            <span>{campo.label}</span>
            {campo.tipo === 'select' || campo.tipo === 'booleano' ? (
              <select
                value={String(valor ?? campo.padrao)}
                onChange={e => onChange(campo.nome, campo.tipo === 'booleano' ? e.target.value === 'true' : e.target.value)}
                className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[10rem]"
              >
                {campo.opcoes?.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
            ) : campo.tipo === 'numero' ? (
              <input
                type="number"
                value={Number(valor ?? campo.padrao)}
                min={0}
                onChange={e => onChange(campo.nome, e.target.value === '' ? 0 : Number(e.target.value))}
                className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 w-24"
              />
            ) : (
              <input
                type="text"
                value={String(valor ?? campo.padrao)}
                onChange={e => onChange(campo.nome, e.target.value)}
                className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[14rem]"
              />
            )}
            {campo.dica && <span className="text-[11px] text-slate-600">{campo.dica}</span>}
          </label>
        );
      })}
    </div>
  );
}

// --- Linha de bloco: seletor de tipo + campos + controles --------------------
function LinhaBloco({ opcoes, bloco, onChange, onRemover, controles, extra }: {
  opcoes: BlocoDef[];
  bloco: BlocoConfig;
  onChange: (novo: BlocoConfig) => void;
  onRemover?: () => void;
  controles?: React.ReactNode;
  // Editor dedicado para blocos com config aninhado (ex.: saltar_se), renderizado
  // no lugar do CamposEditor genérico.
  extra?: React.ReactNode;
}) {
  const def = acharBlocoDef(bloco.tipo) ?? opcoes[0];
  return (
    <div className="bg-[#0f1117]/60 rounded-lg border border-[#2a3147] p-3">
      <div className="flex items-center gap-2">
        <select
          value={bloco.tipo}
          onChange={e => {
            const novoDef = acharBlocoDef(e.target.value)!;
            // Preserva o id estável do passo ao trocar o tipo (saltar_se aponta p/ ele).
            onChange({ id: bloco.id, tipo: novoDef.tipo, config: configPadrao(novoDef) });
          }}
          className="bg-[#1a1f2e] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
        >
          {opcoes.map(o => <option key={o.tipo} value={o.tipo}>{o.label}</option>)}
        </select>
        <span className="text-xs text-slate-500 flex-1 min-w-0 truncate">{def.descricao}</span>
        {controles}
        {onRemover && (
          <button onClick={onRemover} className="text-slate-500 hover:text-red-400 shrink-0" title="Remover">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {extra ?? (
        <CamposEditor
          def={def}
          config={bloco.config}
          onChange={(nome, valor) => onChange({ ...bloco, config: { ...bloco.config, [nome]: valor } })}
        />
      )}
    </div>
  );
}

// --- Editor dedicado do bloco 'saltar_se' (condição aninhada + destino) -------
function SaltarSeEditor({ bloco, acoes, onChange }: {
  bloco: BlocoConfig;
  acoes: BlocoConfig[];
  onChange: (novo: BlocoConfig) => void;
}) {
  const cond = (bloco.config.condicao as BlocoConfig | undefined) ?? blocoPadrao(CONDICOES[0]);
  const condDef = acharBlocoDef(cond.tipo) ?? CONDICOES[0];
  const destino = String(bloco.config.destino ?? '');
  const setCond = (novo: BlocoConfig) => onChange({ ...bloco, config: { ...bloco.config, condicao: novo } });
  return (
    <div className="mt-2 space-y-2 border-l-2 border-sky-500/30 pl-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">Se</span>
        <select
          value={cond.tipo}
          onChange={e => { const d = acharBlocoDef(e.target.value)!; setCond({ tipo: d.tipo, config: configPadrao(d) }); }}
          className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
        >
          {CONDICOES.map(c => <option key={c.tipo} value={c.tipo}>{c.label}</option>)}
        </select>
      </div>
      <CamposEditor
        def={condDef}
        config={cond.config}
        onChange={(nome, valor) => setCond({ ...cond, config: { ...cond.config, [nome]: valor } })}
      />
      <label className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
        <span>então pular para</span>
        <select
          value={destino}
          onChange={e => onChange({ ...bloco, config: { ...bloco.config, destino: e.target.value } })}
          className="bg-[#0f1117] border border-[#2a3147] rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500/50 min-w-[16rem]"
        >
          <option value="">— escolha um passo —</option>
          {acoes.map((a, idx) => (
            a.id && a.id !== bloco.id
              ? <option key={a.id} value={a.id}>{idx + 1}. {acharBlocoDef(a.tipo)?.label ?? a.tipo}</option>
              : null
          ))}
        </select>
        <span className="text-slate-600">(senão continua no próximo passo)</span>
      </label>
    </div>
  );
}

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [versoes, setVersoes] = useState<WorkflowVersao[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [nome, setNome] = useState('');
  const [def, setDef] = useState<DefinicaoWorkflow>(definicaoVazia());
  const [salvoSnapshot, setSalvoSnapshot] = useState('');

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setLoading(true);
    try {
      const r = await fetch(`/api/workflows/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao carregar');
      const wf = data.workflow as Workflow;
      const vs = (data.versoes ?? []) as WorkflowVersao[];
      const versaoAtual = vs.find(v => v.id === wf.versao_atual_id);
      // Base de edição: rascunho pendente, senão a versão publicada, senão vazio.
      // garantirIdsAcoes: backfill de ids em defs antigas (alvos de saltar_se).
      const base = garantirIdsAcoes(wf.rascunho_definicao ?? versaoAtual?.definicao ?? definicaoVazia());
      setWorkflow(wf);
      setVersoes(vs);
      setStats(data.execucoesPorStatus ?? {});
      setNome(wf.nome);
      setDef(base);
      setSalvoSnapshot(JSON.stringify({ nome: wf.nome, def: base }));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar workflow');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const sujo = useMemo(() => JSON.stringify({ nome, def }) !== salvoSnapshot, [nome, def, salvoSnapshot]);

  // Validação client-side espelhando validarDefinicao (feedback antes de publicar).
  const problemas = useMemo(() => {
    const p: string[] = [];
    if (!nome.trim()) p.push('Dê um nome ao workflow.');
    if (!def.gatilho?.tipo) p.push('Escolha um gatilho.');
    if (def.acoes.length === 0) p.push('Adicione ao menos uma ação.');
    return p;
  }, [nome, def]);

  async function salvarRascunho(): Promise<boolean> {
    setOcupado(true); setMsg(null); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), definicao: def }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao salvar');
      setSalvoSnapshot(JSON.stringify({ nome: nome.trim(), def }));
      setMsg('Rascunho salvo.');
      return true;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function acaoCiclo(acao: 'publicar' | 'pausar' | 'retomar') {
    // Publicar sempre persiste o formulário atual como rascunho antes de congelar.
    if (acao === 'publicar') {
      if (problemas.length) { setErro(problemas[0]); return; }
      const ok = await salvarRascunho();
      if (!ok) return;
    }
    setOcupado(true); setMsg(null); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha na ação');
      await carregar();
      setMsg(acao === 'publicar' ? 'Workflow publicado.' : acao === 'pausar' ? 'Workflow pausado.' : 'Workflow retomado.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na ação');
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!confirm('Excluir este rascunho? Esta ação não pode ser desfeita.')) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro || 'Falha ao excluir');
      router.push('/workflows');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
      setOcupado(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-500">
        <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Carregando workflow...</span>
      </div>
    );
  }
  if (erro && !workflow) {
    return (
      <div className="p-6">
        <Link href="/workflows" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><ArrowLeft size={14} /> Voltar</Link>
        <div className="text-center py-20 text-slate-400 text-sm">{erro}</div>
      </div>
    );
  }
  if (!workflow) return null;

  const info = STATUS_INFO[workflow.status];
  const versaoAtual = versoes.find(v => v.id === workflow.versao_atual_id);
  const podeExcluir = workflow.status === 'rascunho' && !workflow.versao_atual_id;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      {/* Cabeçalho */}
      <div>
        <Link href="/workflows" className="text-sm text-slate-400 hover:text-slate-200 flex items-center gap-1 mb-3">
          <ArrowLeft size={14} /> Workflows
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="text-2xl font-bold text-slate-100 bg-transparent border-b border-transparent hover:border-[#2a3147] focus:border-blue-500/50 focus:outline-none w-full"
            />
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
              <span className={`px-2 py-0.5 rounded-full ${info.classes}`}>{info.label}</span>
              {versaoAtual && <span>versão {versaoAtual.numero} vigente</span>}
              {sujo && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> alterações não salvas</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex flex-wrap items-center gap-2 bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-3">
        <button
          onClick={salvarRascunho}
          disabled={ocupado || !sujo}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-slate-200 border border-[#2a3147] hover:bg-[#0f1117] disabled:opacity-50"
        >
          <Save size={14} /> Salvar rascunho
        </button>
        {workflow.status !== 'pausado' && (
          <button
            onClick={() => acaoCiclo('publicar')}
            disabled={ocupado || problemas.length > 0}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-50"
            style={{ backgroundColor: '#1e6f3a' }}
            title={problemas[0]}
          >
            <Rocket size={14} /> {workflow.status === 'publicado' ? 'Republicar' : 'Publicar'}
          </button>
        )}
        {workflow.status === 'publicado' && (
          <button onClick={() => acaoCiclo('pausar')} disabled={ocupado}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-50">
            <PauseCircle size={14} /> Pausar
          </button>
        )}
        {workflow.status === 'pausado' && (
          <button onClick={() => acaoCiclo('retomar')} disabled={ocupado}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-green-300 border border-green-500/30 hover:bg-green-500/10 disabled:opacity-50">
            <CheckCircle2 size={14} /> Retomar
          </button>
        )}
        <div className="flex-1" />
        {ocupado && <Loader2 size={16} className="animate-spin text-slate-500" />}
        {podeExcluir && (
          <button onClick={excluir} disabled={ocupado} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 disabled:opacity-50">
            <Trash2 size={14} /> Excluir
          </button>
        )}
      </div>

      {(msg || erro) && (
        <div className={`text-sm px-3 py-2 rounded-lg ${erro ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-green-500/10 text-green-300 border border-green-500/20'}`}>
          {erro || msg}
        </div>
      )}

      {/* Execuções (se houver) */}
      {Object.keys(stats).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats).map(([s, n]) => (
            <span key={s} className="text-xs bg-[#1a1f2e] border border-[#2a3147] text-slate-300 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
              <PlayCircle size={12} className="text-slate-500" /> {EXEC_LABEL[s] ?? s}: <span className="font-semibold text-slate-100">{n}</span>
            </span>
          ))}
        </div>
      )}

      {workflow.status === 'publicado' && sujo && (
        <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Editar não altera a versão publicada nem as execuções em andamento. Suas mudanças só valem para novas execuções após “Republicar”.
        </div>
      )}

      {/* Gatilho */}
      <section className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-4 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <Zap size={15} className="text-amber-400" /> Gatilho
          <span className="text-xs font-normal text-slate-500">— quando o lead entra no workflow</span>
        </div>
        <LinhaBloco opcoes={GATILHOS} bloco={def.gatilho} onChange={g => setDef({ ...def, gatilho: g })} />
      </section>

      {/* Condições */}
      <section className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-4 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <Filter size={15} className="text-sky-400" /> Condições
          <span className="text-xs font-normal text-slate-500">— todas precisam passar (opcional)</span>
        </div>
        {def.condicoes.length === 0 && <p className="text-xs text-slate-500">Sem condições — o gatilho basta.</p>}
        <div className="space-y-2">
          {def.condicoes.map((c, i) => (
            <LinhaBloco
              key={i}
              opcoes={CONDICOES}
              bloco={c}
              onChange={novo => setDef({ ...def, condicoes: def.condicoes.map((x, j) => (j === i ? novo : x)) })}
              onRemover={() => setDef({ ...def, condicoes: def.condicoes.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <button
          onClick={() => setDef({ ...def, condicoes: [...def.condicoes, blocoPadrao(CONDICOES[0])] })}
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 mt-1"
        >
          <Plus size={13} /> Adicionar condição
        </button>
      </section>

      {/* Ações */}
      <section className="bg-[#1a1f2e] rounded-xl border border-[#2a3147] p-4 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
          <PlayCircle size={15} className="text-green-400" /> Ações
          <span className="text-xs font-normal text-slate-500">— executadas em ordem</span>
        </div>
        {def.acoes.length === 0 && <p className="text-xs text-amber-400/80">Adicione ao menos uma ação para publicar.</p>}
        <div className="space-y-2">
          {def.acoes.map((a, i) => (
            <div key={i} className="flex gap-2 items-stretch">
              <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 w-5 shrink-0 font-mono">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <LinhaBloco
                  opcoes={ACOES}
                  bloco={a}
                  onChange={novo => setDef({ ...def, acoes: def.acoes.map((x, j) => (j === i ? novo : x)) })}
                  onRemover={() => setDef({ ...def, acoes: def.acoes.filter((_, j) => j !== i) })}
                  extra={a.tipo === 'saltar_se' ? (
                    <SaltarSeEditor
                      bloco={a}
                      acoes={def.acoes}
                      onChange={novo => setDef({ ...def, acoes: def.acoes.map((x, j) => (j === i ? novo : x)) })}
                    />
                  ) : undefined}
                  controles={
                    <div className="flex flex-col shrink-0">
                      <button
                        disabled={i === 0}
                        onClick={() => setDef({ ...def, acoes: mover(def.acoes, i, -1) })}
                        className="text-slate-500 hover:text-slate-300 disabled:opacity-30"
                        title="Subir"
                      ><ChevronUp size={14} /></button>
                      <button
                        disabled={i === def.acoes.length - 1}
                        onClick={() => setDef({ ...def, acoes: mover(def.acoes, i, 1) })}
                        className="text-slate-500 hover:text-slate-300 disabled:opacity-30"
                        title="Descer"
                      ><ChevronDown size={14} /></button>
                    </div>
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setDef({ ...def, acoes: [...def.acoes, blocoPadrao(ACOES[0])] })}
          className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 mt-1"
        >
          <Plus size={13} /> Adicionar ação
        </button>
      </section>

      {/* Resumo visual read-only do fluxo (gatilho → público → ações → ramificação → fim) */}
      <ResumoFluxo def={def} />
    </div>
  );
}

// Move o item `i` em `delta` posições (imutável).
function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const copia = [...lista];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}
