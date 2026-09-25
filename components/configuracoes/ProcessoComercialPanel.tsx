'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  SlidersHorizontal, Save, Kanban, ShieldCheck, Users, Check, Loader2, Plus, Pencil, X, Mail,
  AlertCircle, RotateCcw, ArrowUp, ArrowDown, ChevronRight,
} from 'lucide-react';
import { AbasModulo, estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';
import { lerNumeroBr } from '@/lib/numeroBr';
import DistribuicaoComercialPanel from './DistribuicaoComercialPanel';
import EmailProspeccaoPanel from './EmailProspeccaoPanel';

// Painel de Processo comercial — Nomenclaturas, parâmetros de renovação/ROI,
// pipelines editáveis, distribuição comercial (round-robin do handoff),
// e-mail de prospecção e permissões. Dado real de /api/configuracoes/workspace,
// /api/pipelines, /api/configuracoes/distribuicao-comercial e /api/rbac/permissoes.

type Aba = 'geral' | 'pipelines' | 'distribuicao' | 'email' | 'permissoes';

interface Config {
  nomenclaturas?: Record<string, string>;
  renovacao?: { antecedenciaDias?: number };
  roi?: { custoMensal?: number };
}
interface Estagio { id: string; chave: string; nome: string; papel: string; cor: string | null; ordem: number }
interface Pipeline { id: string; nome: string; tipo: string; ativo: boolean; estagios: Estagio[] }
interface RbacView { permissoes: string[]; porRole: Record<string, string[]>; minhas: string[]; role: string }

const PAPEIS = ['inicial', 'normal', 'ganho', 'perdido'] as const;
const ROTULO_PAPEL: Record<string, string> = {
  inicial: 'Entrada',
  normal: 'Em andamento',
  ganho: 'Ganho',
  perdido: 'Perdido',
};

const TABS = [
  { id: 'geral', label: 'Geral', Icon: SlidersHorizontal },
  { id: 'pipelines', label: 'Pipelines', Icon: Kanban },
  { id: 'distribuicao', label: 'Distribuição', Icon: Users },
  { id: 'email', label: 'E-mail de prospecção', Icon: Mail },
  { id: 'permissoes', label: 'Permissões', Icon: ShieldCheck },
] as const;

function slugificar(nome: string, sufixo: string | number) {
  return nome.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + sufixo;
}

// Vazio = "não alterar" (o servidor mantém o valor atual). Formato brasileiro:
// "1.500,50", "1500,5" e "45" (ver lerNumeroBr).
function lerNumero(txt: string, inteiro: boolean): number | null | 'invalido' {
  const n = lerNumeroBr(txt);
  if (n === null) return null;
  if (!Number.isFinite(n) || n < 0 || (inteiro && !Number.isInteger(n))) return 'invalido';
  return n;
}

// Mesmas regras do PUT /api/pipelines/[id]/estagios, checadas antes de enviar.
function validarEstagios(estagios: Estagio[]): string | null {
  if (estagios.length === 0) return 'O pipeline precisa de ao menos um estágio.';
  if (estagios.some((e) => !e.nome.trim())) return 'Todo estágio precisa de nome.';
  if (estagios.filter((e) => e.papel === 'inicial').length > 1) return 'Só um estágio pode ser de entrada.';
  return null;
}

async function lerErro(res: Response, padrao: string) {
  const j = await res.json().catch(() => null);
  return (j && typeof j.erro === 'string' && j.erro) || padrao;
}

export default function ProcessoComercialPanel() {
  const [aba, setAba] = useState<Aba>('geral');
  const [carregando, setCarregando] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [antecedencia, setAntecedencia] = useState('');
  const [custo, setCusto] = useState('');
  const [nomeLead, setNomeLead] = useState('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [rbac, setRbac] = useState<RbacView | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  // Estado de edição de pipeline
  const [criando, setCriando] = useState(false);
  const [editBuffers, setEditBuffers] = useState<Record<string, Estagio[]>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [salvoId, setSalvoId] = useState<string | null>(null);
  const [erroPipeline, setErroPipeline] = useState<Record<string, string>>({});

  function aplicarConfig(c: Config | null) {
    setConfig(c);
    setAntecedencia(String(c?.renovacao?.antecedenciaDias ?? ''));
    setCusto(String(c?.roi?.custoMensal ?? '').replace('.', ','));
    setNomeLead(c?.nomenclaturas?.lead ?? '');
  }

  const carregar = useCallback(async () => {
    try {
      const [c, p, r] = await Promise.all([
        fetch('/api/configuracoes/workspace').then((x) => (x.ok ? x.json() : null)),
        fetch('/api/pipelines').then((x) => (x.ok ? x.json() : { pipelines: [] })),
        fetch('/api/rbac/permissoes').then((x) => (x.ok ? x.json() : null)),
      ]);
      if (c) { aplicarConfig(c.config); setPodeEditar(!!c.podeEditar); }
      setPipelines(p.pipelines ?? []);
      setRbac(r);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alteradoGeral =
    antecedencia !== String(config?.renovacao?.antecedenciaDias ?? '') ||
    custo !== String(config?.roi?.custoMensal ?? '').replace('.', ',') ||
    nomeLead !== (config?.nomenclaturas?.lead ?? '');

  async function salvar() {
    if (salvando) return;
    setErroGeral(null); setSalvo(false);

    const dias = lerNumero(antecedencia, true);
    const valor = lerNumero(custo, false);
    if (dias === 'invalido') { setErroGeral('Antecedência deve ser um número inteiro de dias, 0 ou mais.'); return; }
    if (valor === 'invalido') { setErroGeral('Custo mensal deve ser um valor em reais, 0 ou mais.'); return; }

    setSalvando(true);
    try {
      const body: Record<string, unknown> = {};
      if (dias !== null) body.renovacaoAntecedenciaDias = dias;
      if (valor !== null) body.roiCustoMensal = valor;
      if (nomeLead.trim()) body.nomenclaturas = { ...(config?.nomenclaturas ?? {}), lead: nomeLead.trim() };
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setErroGeral(await lerErro(res, 'Não foi possível salvar.')); return; }
      const j = await res.json();
      aplicarConfig(j.config);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch {
      setErroGeral('Falha de conexão ao salvar.');
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
    setErroPipeline((e) => { const { [pId]: _, ...rest } = e; return rest; });
  }

  function alterarLista(pId: string, fn: (list: Estagio[]) => Estagio[]) {
    setEditBuffers((b) => ({ ...b, [pId]: fn([...(b[pId] ?? [])]) }));
    setErroPipeline((e) => { const { [pId]: _, ...rest } = e; return rest; });
  }

  function atualizarEstagio(pId: string, idx: number, campo: keyof Estagio, valor: string) {
    alterarLista(pId, (list) => { list[idx] = { ...list[idx], [campo]: valor }; return list; });
  }

  function moverEstagio(pId: string, idx: number, delta: -1 | 1) {
    alterarLista(pId, (list) => {
      const alvo = idx + delta;
      if (alvo < 0 || alvo >= list.length) return list;
      [list[idx], list[alvo]] = [list[alvo], list[idx]];
      return list;
    });
  }

  function addEstagio(pId: string) {
    alterarLista(pId, (list) => [...list, {
      id: '',
      chave: slugificar('estagio', Date.now()),
      nome: 'Novo estágio',
      papel: 'normal',
      cor: '#64748b',
      ordem: list.length,
    }]);
  }

  function removeEstagio(pId: string, idx: number) {
    alterarLista(pId, (list) => list.filter((_, i) => i !== idx));
  }

  async function salvarPipeline(pId: string) {
    if (salvandoId) return;
    const estagios = (editBuffers[pId] ?? []).map((e, i) => ({ ...e, ordem: i }));
    const invalido = validarEstagios(estagios);
    if (invalido) { setErroPipeline((e) => ({ ...e, [pId]: invalido })); return; }

    setSalvandoId(pId);
    try {
      const res = await fetch(`/api/pipelines/${pId}/estagios`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estagios }),
      });
      if (!res.ok) {
        const msg = await lerErro(res, 'Não foi possível salvar o pipeline.');
        setErroPipeline((e) => ({ ...e, [pId]: msg }));
        return;
      }
      cancelarEdicao(pId);
      setSalvoId(pId);
      setTimeout(() => setSalvoId(null), 2000);
      await carregar();
    } catch {
      setErroPipeline((e) => ({ ...e, [pId]: 'Falha de conexão ao salvar.' }));
    } finally { setSalvandoId(null); }
  }

  const input = 'w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 disabled:opacity-50';
  const inputCompacto = 'bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-400';

  const avisoLeitura = !podeEditar && (
    <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
      <ShieldCheck size={13} /> Somente leitura — requer a permissão <code>workspace.configure</code> para editar.
    </p>
  );

  if (carregando) {
    return <div className={`${m.painel} h-56 animate-pulse`} />;
  }

  return (
    <div className="space-y-4">
      <AbasModulo rotulo="Seções do processo comercial" abas={TABS} ativa={aba} onChange={setAba} />

      {aba === 'geral' && (
        <section className={`${m.painel} max-w-2xl`}>
          <div className={m.painelBarra}>
            <TituloSecao icone={SlidersHorizontal} titulo="Geral" subtitulo="Como a operação chama o lead e os parâmetros de renovação e ROI." />
          </div>
          <div className="grid gap-4 p-4">
            {avisoLeitura}
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-slate-300">Como chamar &quot;lead&quot;</span>
              <input className={input} value={nomeLead} onChange={(e) => setNomeLead(e.target.value)} disabled={!podeEditar} placeholder="Lead" />
              <span className="text-xs text-slate-400">Nome usado nas telas para o registro de prospecção (ex.: Oportunidade, Cliente potencial).</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-300">Renovação — antecedência</span>
                <div className="relative">
                  <input className={`${input} pr-12`} value={antecedencia} onChange={(e) => setAntecedencia(e.target.value)} disabled={!podeEditar} inputMode="numeric" placeholder="45" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">dias</span>
                </div>
                <span className="text-xs text-slate-400">Contratos que vencem dentro desta janela entram no público de renovação.</span>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-300">ROI — custo mensal de referência</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
                  <input className={`${input} pl-9`} value={custo} onChange={(e) => setCusto(e.target.value)} disabled={!podeEditar} inputMode="decimal" placeholder="0,00" />
                </div>
                <span className="text-xs text-slate-400">Custo usado no cálculo de ROI da operação (Analytics).</span>
              </label>
            </div>
          </div>
          {podeEditar && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] p-4">
              <button type="button" onClick={salvar} disabled={salvando || !alteradoGeral} className={`${m.primaryButton} focus-ring`}>
                {salvando ? <Loader2 size={15} className="animate-spin" /> : salvo ? <Check size={15} /> : <Save size={15} />}
                {salvando ? 'Salvando…' : salvo ? 'Salvo' : 'Salvar'}
              </button>
              {alteradoGeral && !salvando && (
                <button type="button" onClick={() => { aplicarConfig(config); setErroGeral(null); }} className={`${m.outlineButton} focus-ring`}>
                  <RotateCcw size={14} /> Descartar
                </button>
              )}
              {erroGeral && <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erroGeral}</p>}
            </div>
          )}
        </section>
      )}

      {aba === 'pipelines' && (
        <div className="space-y-4">
          {avisoLeitura}
          {pipelines.length === 0 ? (
            <section className={`${m.painel} flex flex-col items-center justify-center gap-3 py-14`}>
              <Kanban size={32} className="text-slate-500" />
              <p className="font-medium text-slate-200">Nenhum pipeline configurado</p>
              <p className="max-w-xs text-center text-sm text-slate-400">
                Crie um pipeline para organizar as etapas do seu processo comercial.
              </p>
              {podeEditar && (
                <button type="button" onClick={criarPipeline} disabled={criando} className={`${m.primaryButton} mt-1 focus-ring`}>
                  {criando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Criar pipeline padrão
                </button>
              )}
            </section>
          ) : (
            pipelines.map((p) => {
              const em = editBuffers[p.id];
              const editando = !!em;
              const erro = erroPipeline[p.id];
              return (
                <section key={p.id} className={m.painel}>
                  <div className={m.painelBarra}>
                    <TituloSecao
                      icone={Kanban}
                      titulo={p.nome}
                      subtitulo={`${p.tipo} · ${p.estagios.length} estágio${p.estagios.length === 1 ? '' : 's'}`}
                    />
                    {salvoId === p.id && !editando && (
                      <span className="chip chip-success"><Check size={12} /> Salvo</span>
                    )}
                    {!editando && podeEditar && (
                      <button type="button" onClick={() => iniciarEdicao(p)} className={`${m.outlineButton} focus-ring`}>
                        <Pencil size={13} /> Editar estágios
                      </button>
                    )}
                  </div>

                  {editando ? (
                    <div className="grid gap-2 p-4">
                      <ol className="grid gap-2">
                        {em.map((e, i) => (
                          <li key={e.chave} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2">
                            <span className="w-5 text-center text-xs tabular-nums text-slate-400">{i + 1}</span>
                            <div className="flex flex-col">
                              <button type="button" onClick={() => moverEstagio(p.id, i, -1)} disabled={i === 0}
                                className="rounded p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 focus-ring" aria-label="Mover para cima">
                                <ArrowUp size={12} />
                              </button>
                              <button type="button" onClick={() => moverEstagio(p.id, i, 1)} disabled={i === em.length - 1}
                                className="rounded p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30 focus-ring" aria-label="Mover para baixo">
                                <ArrowDown size={12} />
                              </button>
                            </div>
                            <input
                              type="color"
                              value={e.cor ?? '#64748b'}
                              onChange={(ev) => atualizarEstagio(p.id, i, 'cor', ev.target.value)}
                              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
                              title="Cor do estágio"
                            />
                            <input
                              value={e.nome}
                              onChange={(ev) => atualizarEstagio(p.id, i, 'nome', ev.target.value)}
                              className={`${inputCompacto} min-w-0 flex-1 ${!e.nome.trim() ? 'border-red-400/60' : ''}`}
                              placeholder="Nome do estágio"
                            />
                            <select
                              value={e.papel}
                              onChange={(ev) => atualizarEstagio(p.id, i, 'papel', ev.target.value)}
                              className={`${inputCompacto} text-xs`}
                              title="Papel do estágio no funil"
                            >
                              {PAPEIS.map((papel) => (
                                <option key={papel} value={papel}>{ROTULO_PAPEL[papel]}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => removeEstagio(p.id, i)}
                              className="shrink-0 rounded p-1 text-slate-400 hover:text-red-300 focus-ring" aria-label={`Remover estágio ${e.nome}`}>
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ol>
                      <button type="button" onClick={() => addEstagio(p.id)}
                        className="inline-flex w-fit items-center gap-1 pt-1 text-xs text-indigo-300 hover:text-indigo-200">
                        <Plus size={12} /> Adicionar estágio
                      </button>
                      <p className="text-xs text-slate-400">
                        Estágio removido é desativado, não apagado.
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                        <button type="button" onClick={() => salvarPipeline(p.id)} disabled={salvandoId === p.id} className={`${m.primaryButton} focus-ring`}>
                          {salvandoId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          {salvandoId === p.id ? 'Salvando…' : 'Salvar estágios'}
                        </button>
                        <button type="button" onClick={() => cancelarEdicao(p.id)} className={`${m.outlineButton} focus-ring`}>
                          Cancelar
                        </button>
                        {erro && <p className="flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {erro}</p>}
                      </div>
                    </div>
                  ) : (
                    <ol className="flex flex-wrap items-center gap-1.5 p-4">
                      {p.estagios.map((e, i) => (
                        <li key={e.id} className="flex items-center gap-1.5">
                          {i > 0 && <ChevronRight size={13} className="text-slate-500" aria-hidden="true" />}
                          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                            style={{ borderColor: (e.cor ?? '#64748b') + '80', backgroundColor: (e.cor ?? '#64748b') + '1f' }}>
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.cor ?? '#64748b' }} />
                            <span className="text-slate-100">{e.nome}</span>
                            {e.papel !== 'normal' && <span className="text-slate-400">· {ROTULO_PAPEL[e.papel] ?? e.papel}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}

      {aba === 'distribuicao' && <DistribuicaoComercialPanel />}

      {aba === 'email' && <EmailProspeccaoPanel />}

      {aba === 'permissoes' && (
        <section className={`${m.painel} max-w-2xl`}>
          <div className={m.painelBarra}>
            <TituloSecao
              icone={ShieldCheck}
              titulo="Permissões"
              subtitulo={rbac ? `Seu papel: ${rbac.role} · ${rbac.minhas.length} de ${rbac.permissoes.length} permissões` : 'O que o seu acesso permite fazer.'}
            />
          </div>
          {rbac ? (
            <ul className="grid gap-1.5 p-4 sm:grid-cols-2">
              {rbac.permissoes.map((perm) => {
                const tem = rbac.minhas.includes(perm);
                return (
                  <li key={perm} className="flex items-center gap-2 text-sm">
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded ${tem ? 'bg-green-500/20 text-green-400' : 'bg-slate-700/40 text-slate-500'}`}>
                      {tem && <Check size={11} />}
                    </span>
                    <code className={tem ? 'text-slate-100' : 'text-slate-500'}>{perm}</code>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 p-4 text-sm text-slate-400">
              <AlertCircle size={14} /> Não foi possível carregar as permissões.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
