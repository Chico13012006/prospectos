'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Building2, Check, ChevronDown, ChevronRight, Database, Download, ListChecks, Mail, MapPin,
  Radar, RotateCcw, Search, Settings, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import type { FiltrosBusca } from '@/lib/prospeccao/filtros';
import type { ResultadoCatalogo, StatusCatalogo } from '@/lib/prospeccao/buscaServidor';
import { ROTULO_QUALIDADE, type QualidadeEmail } from '@/lib/prospeccao/qualidadeEmail';
import { formatarCnae, iniciais, nomeLegivel, rotuloPorte, ROTULO_PORTE } from '@/lib/prospeccao/rotulos';
import { formatarCnpj } from '@/lib/empresas/cnpj';
import { PORTES_PROSPECCAO, UFS_BRASIL, type PorteProspeccao } from '@/lib/config/workspaceConfig';
import DetalheEmpresa, { type Decisor } from '@/components/prospeccao/DetalheEmpresa';
import ImportarProspeccaoModal from '@/components/prospeccao/ImportarProspeccaoModal';
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao';

// Prospecção: buscar no catálogo da Receita → analisar → selecionar →
// importar → iniciar prospecção (wizard de campanha). A busca parte do perfil
// da organização (Configurações › Perfil de busca).

// Qualidade do e-mail como texto colorido discreto (sem caixa), para não
// competir com o próprio e-mail na linha.
const COR_QUALIDADE: Record<QualidadeEmail, string> = {
  corporativo: 'text-emerald-400',
  generico: 'text-sky-400',
  pessoal: 'text-amber-400',
  contabilidade: 'text-red-400',
  digitacao: 'text-red-400',
  sem_email: 'text-slate-500',
};
const PONTO_QUALIDADE: Record<QualidadeEmail, string> = {
  corporativo: 'bg-emerald-400',
  generico: 'bg-sky-400',
  pessoal: 'bg-amber-400',
  contabilidade: 'bg-red-400',
  digitacao: 'bg-red-400',
  sem_email: 'bg-slate-600',
};

// Paleta discreta para o avatar, estável por CNPJ.
const CORES_AVATAR = [
  'bg-indigo-500/15 text-indigo-300',
  'bg-sky-500/15 text-sky-300',
  'bg-emerald-500/15 text-emerald-300',
  'bg-amber-500/15 text-amber-300',
  'bg-rose-500/15 text-rose-300',
  'bg-violet-500/15 text-violet-300',
];
function corAvatar(cnpj: string): string {
  let h = 0;
  for (const ch of cnpj) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_AVATAR[h % CORES_AVATAR.length];
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesRfLegivel(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

interface RespostaApi {
  itens: ResultadoCatalogo[];
  proximoCursor: string | null;
  total: number | null;
  catalogo: StatusCatalogo | null;
  filtros: FiltrosBusca;
  perfil: FiltrosBusca;
  temPerfil: boolean;
}

const CLASSE_CAMPO =
  'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] text-sm text-slate-200 hover:border-[var(--border-strong)] focus-ring';

// Rótulo em cima, campo embaixo: cada filtro lê como um item de formulário.
function Campo({ rotulo, children, className = '' }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-slate-400">{rotulo}</span>
      {children}
    </label>
  );
}

// <select> nativo com a aparência dos demais campos.
function Selecao({
  valor, onChange, children, rotuloAcessivel,
}: { valor: string; onChange: (v: string) => void; children: React.ReactNode; rotuloAcessivel: string }) {
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-label={rotuloAcessivel}
        className={`${CLASSE_CAMPO} appearance-none pl-3 pr-9 cursor-pointer`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
    </div>
  );
}

// Seletor de UFs em popover: 27 estados numa grade, sem ocupar a tela.
function SeletorUf({ selecionadas, onChange }: { selecionadas: string[]; onChange: (ufs: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fechar); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const rotulo = selecionadas.length === 0
    ? 'Todo o Brasil'
    : selecionadas.length <= 3 ? selecionadas.join(', ') : `${selecionadas.length} estados`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-label="Estados"
        className={`${CLASSE_CAMPO} flex items-center gap-2 px-3 text-left`}
      >
        <MapPin size={14} className="shrink-0 text-slate-500" />
        <span className="flex-1 truncate">{rotulo}</span>
        <ChevronDown size={15} className={`shrink-0 text-slate-500 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-2xl shadow-black/40">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">Estados</span>
            {selecionadas.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-xs text-indigo-300 hover:text-indigo-200 focus-ring rounded">
                Todo o Brasil
              </button>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {UFS_BRASIL.map((uf) => {
              const ativo = selecionadas.includes(uf);
              return (
                <button
                  type="button"
                  key={uf}
                  onClick={() => onChange(ativo ? selecionadas.filter((u) => u !== uf) : [...selecionadas, uf])}
                  aria-pressed={ativo}
                  className={`h-9 rounded-md text-xs font-medium transition-colors focus-ring ${
                    ativo ? 'bg-[var(--accent)] text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  {uf}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Alternar({ ativo, onChange, children }: { ativo: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ativo}
      onClick={() => onChange(!ativo)}
      className="flex items-center gap-2.5 text-sm text-slate-400 hover:text-slate-200 focus-ring rounded-md"
    >
      <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${ativo ? 'bg-[var(--accent)]' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${ativo ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
      {children}
    </button>
  );
}

function Indicador({ icone: Icone, rotulo, valor, detalhe, destaque = false }: {
  icone: typeof Building2; rotulo: string; valor: string; detalhe: string; destaque?: boolean;
}) {
  return (
    <div className={`card p-5 ${destaque ? 'ring-1 ring-inset ring-indigo-500/25' : ''}`}>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Icone size={15} className={destaque ? 'text-indigo-300' : 'text-slate-500'} /> {rotulo}
      </div>
      <div className={`mt-2 font-bold tabular-nums leading-none ${destaque ? 'text-4xl text-slate-50' : 'text-3xl text-slate-100'}`}>{valor}</div>
      <p className="mt-2 text-xs text-slate-500">{detalhe}</p>
    </div>
  );
}

function LinhasEsqueleto() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} className="skeleton-pulse">
          <td className="px-5 py-5 border-b border-[var(--border-subtle)]"><div className="h-4 w-4 rounded bg-slate-700/60" /></td>
          <td className="px-3 py-5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-slate-700/60" />
              <div className="space-y-2"><div className="h-3 w-48 rounded bg-slate-700/60" /><div className="h-2.5 w-28 rounded bg-slate-700/40" /></div>
            </div>
          </td>
          <td className="px-4 py-5 border-b border-[var(--border-subtle)]"><div className="h-3 w-28 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-5 border-b border-[var(--border-subtle)]"><div className="h-3 w-20 rounded bg-slate-700/50" /></td>
          <td className="px-4 py-5 border-b border-[var(--border-subtle)]"><div className="h-3 w-44 rounded bg-slate-700/50" /></td>
          <td className="px-5 py-5 border-b border-[var(--border-subtle)]" />
        </tr>
      ))}
    </>
  );
}

export default function ProspeccaoPage() {
  const [filtros, setFiltros] = useState<FiltrosBusca | null>(null);
  const [perfil, setPerfil] = useState<FiltrosBusca | null>(null);
  const [temPerfil, setTemPerfil] = useState<boolean | null>(null);
  const [catalogo, setCatalogo] = useState<StatusCatalogo | null>(null);
  const [itens, setItens] = useState<ResultadoCatalogo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Map<string, ResultadoCatalogo>>(() => new Map());
  const [decisores, setDecisores] = useState<Record<string, Decisor | null>>({});
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [importando, setImportando] = useState(false);
  const [texto, setTexto] = useState('');
  // Só a resposta da busca mais recente pode escrever no estado.
  const buscaAtual = useRef(0);

  const buscar = useCallback(async (f: FiltrosBusca | null, apos: string | null) => {
    const id = ++buscaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch('/api/prospeccao/busca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filtros: f ?? undefined, cursor: apos }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<RespostaApi> & { erro?: string };
      if (id !== buscaAtual.current) return;
      if (!res.ok) throw new Error(corpo.erro || 'Falha na busca');
      setCatalogo(corpo.catalogo ?? null);
      setTemPerfil(!!corpo.temPerfil);
      setPerfil(corpo.perfil ?? null);
      if (!f) setFiltros(corpo.filtros ?? null);
      setItens((atual) => (apos ? [...atual, ...(corpo.itens ?? [])] : corpo.itens ?? []));
      setCursor(corpo.proximoCursor ?? null);
      if (!apos) setTotal(corpo.total ?? null);
    } catch (e) {
      if (id === buscaAtual.current) setErro(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      if (id === buscaAtual.current) setCarregando(false);
    }
  }, []);

  // 1ª carga: sem filtros → o servidor aplica o perfil e devolve os filtros efetivos.
  useEffect(() => { buscar(null, null); }, [buscar]);

  // Texto com debounce; demais filtros disparam na hora.
  useEffect(() => {
    if (!filtros) return;
    const t = setTimeout(() => {
      if (texto !== filtros.texto) setFiltros((f) => (f ? { ...f, texto } : f));
    }, 300);
    return () => clearTimeout(t);
  }, [texto, filtros]);

  const primeiraExecucao = useRef(true);
  useEffect(() => {
    if (!filtros) return;
    if (primeiraExecucao.current) { primeiraExecucao.current = false; return; }
    setAberto(null);
    buscar(filtros, null);
  }, [filtros, buscar]);

  function atualizar(patch: Partial<FiltrosBusca>) {
    setFiltros((f) => (f ? { ...f, ...patch } : f));
  }

  function alternarSelecao(item: ResultadoCatalogo) {
    if (item.ja_na_base) return;
    setConfirmandoDescarte(false);
    setSelecionados((m) => {
      const n = new Map(m);
      if (n.has(item.cnpj)) n.delete(item.cnpj); else n.set(item.cnpj, item);
      return n;
    });
  }

  const selecionaveis = useMemo(() => itens.filter((i) => !i.ja_na_base), [itens]);
  const todosSelecionados = selecionaveis.length > 0 && selecionaveis.every((i) => selecionados.has(i.cnpj));

  function alternarTodos() {
    setConfirmandoDescarte(false);
    setSelecionados((m) => {
      const n = new Map(m);
      if (todosSelecionados) selecionaveis.forEach((i) => n.delete(i.cnpj));
      else selecionaveis.forEach((i) => n.set(i.cnpj, i));
      return n;
    });
  }

  async function descartar() {
    const cnpjs = [...selecionados.keys()];
    setConfirmandoDescarte(false);
    try {
      const res = await fetch('/api/prospeccao/descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpjs }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.erro || 'Falha ao descartar');
      setItens((atual) => atual.filter((i) => !selecionados.has(i.cnpj)));
      setTotal((t) => (t === null ? t : Math.max(0, t - cnpjs.length)));
      setSelecionados(new Map());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao descartar');
    }
  }

  function aoImportar(cnpjs: string[]) {
    const importados = new Set(cnpjs);
    setItens((atual) => atual.map((i) => (importados.has(i.cnpj) ? { ...i, ja_na_base: true } : i)));
    setSelecionados((m) => {
      const n = new Map(m);
      cnpjs.forEach((c) => n.delete(c));
      return n;
    });
  }

  const itensImportacao = [...selecionados.values()].map((i) => ({
    cnpj: i.cnpj,
    nome: i.nome_fantasia ?? i.razao_social ?? i.cnpj,
    email: i.email,
    contato_nome: decisores[i.cnpj]?.nome?.trim() || null,
    contato_cargo: decisores[i.cnpj]?.cargo?.trim() || null,
  }));

  // Quantos filtros diferem do perfil — orienta o "Restaurar perfil".
  const ajustesAtivos = useMemo(() => {
    if (!filtros || !perfil) return 0;
    const igual = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    return [
      !igual(filtros.cnaes, perfil.cnaes),
      !igual(filtros.ufs, perfil.ufs),
      !igual(filtros.portes, perfil.portes),
      filtros.soComEmail !== perfil.soComEmail,
      filtros.excluirMei !== perfil.excluirMei,
      filtros.incluirCnaesSecundarios !== perfil.incluirCnaesSecundarios,
      !!texto,
    ].filter(Boolean).length;
  }, [filtros, perfil, texto]);

  const semPerfil = temPerfil === false;

  // Atividade e Porte são selects: "todos do perfil" ou um valor específico.
  const valorAtividade = filtros && perfil
    ? (filtros.cnaes.length === 1 ? filtros.cnaes[0] : filtros.cnaes.length === perfil.cnaes.length ? '' : '__parcial__')
    : '';
  const valorPorte = filtros
    ? (filtros.portes.length === 0 ? '' : filtros.portes.length === 1 ? filtros.portes[0] : '__varios__')
    : '';
  const carregados = itens.length;

  return (
    <div className="h-screen overflow-y-auto">
      <div className="w-full px-6 py-6 space-y-6 xl:px-10">
        {/* Cabeçalho */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] ring-1 ring-inset ring-indigo-500/30">
              <Radar size={22} className="text-indigo-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Prospecção</h1>
              <p className="mt-1 text-sm text-slate-400">Encontre empresas novas na Receita Federal e traga para a base as que fazem sentido.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {catalogo ? (
              <span
                className="flex items-center gap-1.5 text-xs text-slate-500"
                title={catalogo.concluidaEm ? `Carga concluída em ${new Date(catalogo.concluidaEm).toLocaleString('pt-BR')}` : undefined}
              >
                <Database size={13} /> Dados da Receita de {mesRfLegivel(catalogo.mesRf)}
              </span>
            ) : temPerfil !== null && (
              <span className="chip chip-warning"><Database size={11} /> Catálogo sem carga concluída</span>
            )}
            <Link href="/configuracoes?tab=prospeccao" className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm text-slate-300 hover:bg-white/5 focus-ring">
              <Settings size={14} /> Perfil de busca
            </Link>
          </div>
        </header>

        {semPerfil ? (
          <div className="card p-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
              <SlidersHorizontal size={24} className="text-indigo-300" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-slate-100">Defina o perfil de busca</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              Escolha as atividades (CNAE), estados e porte das empresas que você quer prospectar. A busca começa por ele.
            </p>
            <Link href="/configuracoes?tab=prospeccao" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] focus-ring">
              <Settings size={15} /> Configurar perfil de busca
            </Link>
          </div>
        ) : (
          <>
            {/* Filtros */}
            {filtros && perfil && (
              <section className="card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">Filtros</h2>
                  {ajustesAtivos > 0 && (
                    <button
                      type="button"
                      onClick={() => { setTexto(''); setFiltros({ ...perfil }); }}
                      className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 focus-ring rounded"
                    >
                      <RotateCcw size={12} /> Voltar ao perfil
                    </button>
                  )}
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]">
                  <Campo rotulo="Buscar">
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder="Nome da empresa ou CNPJ"
                        className={`${CLASSE_CAMPO} pl-9 pr-9`}
                      />
                      {texto && (
                        <button type="button" onClick={() => setTexto('')} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </Campo>

                  <Campo rotulo="Atividade (CNAE)">
                    <Selecao
                      rotuloAcessivel="Atividade"
                      valor={valorAtividade}
                      onChange={(v) => atualizar({ cnaes: v === '' ? [...perfil.cnaes] : [v] })}
                    >
                      <option value="">Todas do perfil ({perfil.cnaes.length})</option>
                      {valorAtividade === '__parcial__' && <option value="__parcial__" disabled>{filtros.cnaes.length} selecionadas</option>}
                      {perfil.cnaes.map((c) => <option key={c} value={c}>{formatarCnae(c)}</option>)}
                    </Selecao>
                  </Campo>

                  <Campo rotulo="Estado">
                    <SeletorUf selecionadas={filtros.ufs} onChange={(ufs) => atualizar({ ufs })} />
                  </Campo>

                  <Campo rotulo="Porte">
                    <Selecao
                      rotuloAcessivel="Porte"
                      valor={valorPorte}
                      onChange={(v) => atualizar({ portes: v === '' ? [] : [v as PorteProspeccao] })}
                    >
                      <option value="">Todos os portes</option>
                      {valorPorte === '__varios__' && <option value="__varios__" disabled>{filtros.portes.length} portes (perfil)</option>}
                      {PORTES_PROSPECCAO.map((p) => <option key={p} value={p}>{ROTULO_PORTE[p]}</option>)}
                    </Selecao>
                  </Campo>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-[var(--border-subtle)] pt-5">
                  <Alternar ativo={filtros.soComEmail} onChange={(v) => atualizar({ soComEmail: v })}>Só com e-mail</Alternar>
                  <Alternar ativo={filtros.excluirMei} onChange={(v) => atualizar({ excluirMei: v })}>Excluir MEI</Alternar>
                  <Alternar ativo={filtros.incluirCnaesSecundarios} onChange={(v) => atualizar({ incluirCnaesSecundarios: v })}>Incluir atividade secundária</Alternar>
                </div>
              </section>
            )}

            {/* Resumo */}
            <section className="grid gap-4 sm:grid-cols-3">
              <Indicador
                destaque
                icone={Building2}
                rotulo="Empresas encontradas"
                valor={total === null ? '—' : total.toLocaleString('pt-BR')}
                detalhe={carregando && carregados === 0 ? 'Buscando…' : 'no catálogo, com os filtros atuais'}
              />
              <Indicador
                icone={ListChecks}
                rotulo="Na lista"
                valor={carregados.toLocaleString('pt-BR')}
                detalhe={cursor ? 'use “Carregar mais” no fim da lista' : 'todas as encontradas estão na lista'}
              />
              <Indicador
                icone={Check}
                rotulo="Selecionadas"
                valor={selecionados.size.toLocaleString('pt-BR')}
                detalhe={selecionados.size ? 'prontas para importar' : 'marque as empresas que interessam'}
              />
            </section>

            {erro && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{erro}</p>
            )}

            {/* Resultados */}
            <section className="card">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-200">Resultados</h2>
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <CaixaSelecao marcado={todosSelecionados} onChange={alternarTodos} />
                  Selecionar todas da lista
                </label>
              </div>
              <table className="w-full table-fixed text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-500">
                    <th className="w-14 px-5 py-3 border-b border-[var(--border-subtle)]"><span className="sr-only">Selecionar</span></th>
                    <th className="w-[34%] px-3 py-3 border-b border-[var(--border-subtle)] font-medium">Empresa</th>
                    <th className="w-[18%] px-4 py-3 border-b border-[var(--border-subtle)] font-medium">Cidade</th>
                    <th className="w-[14%] px-4 py-3 border-b border-[var(--border-subtle)] font-medium">Porte</th>
                    <th className="px-4 py-3 border-b border-[var(--border-subtle)] font-medium">E-mail</th>
                    <th className="w-36 px-5 py-3 border-b border-[var(--border-subtle)]"><span className="sr-only">Situação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {carregando && carregados === 0 ? (
                    <LinhasEsqueleto />
                  ) : carregados === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-24 text-center">
                        <Building2 size={30} className="mx-auto text-slate-600" />
                        <p className="mt-4 text-sm font-medium text-slate-300">Nenhuma empresa com esses filtros</p>
                        <p className="mt-1 text-sm text-slate-500">Tente ampliar os estados ou o porte.</p>
                      </td>
                    </tr>
                  ) : (
                    itens.map((i) => {
                      const expandido = aberto === i.cnpj;
                      const selecionado = selecionados.has(i.cnpj);
                      const decisor = decisores[i.cnpj];
                      const nome = nomeLegivel(i.nome_fantasia ?? i.razao_social) || formatarCnpj(i.cnpj);
                      const celula = expandido ? '' : 'border-b border-[var(--border-subtle)]';
                      return (
                        <Fragment key={i.cnpj}>
                          <tr
                            onClick={() => setAberto(expandido ? null : i.cnpj)}
                            className={`group cursor-pointer transition-colors ${
                              selecionado ? 'bg-[var(--accent-soft)]' : expandido ? 'bg-[var(--bg-card-hover)]' : 'hover:bg-[var(--bg-card-hover)]'
                            }`}
                          >
                            <td className={`w-14 px-5 py-4 ${celula} ${selecionado ? 'shadow-[inset_3px_0_0_var(--accent)]' : ''}`} onClick={(e) => e.stopPropagation()}>
                              <CaixaSelecao
                                desabilitado={i.ja_na_base}
                                marcado={selecionado}
                                onChange={() => alternarSelecao(i)}
                                rotulo={i.ja_na_base ? `${nome} já está na base` : `Selecionar ${nome}`}
                              />
                            </td>
                            <td className={`px-3 py-4 ${celula}`}>
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${corAvatar(i.cnpj)}`}>
                                  {iniciais(nome)}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="min-w-0 font-medium text-slate-100 truncate">{nome}</span>
                                    <ChevronRight size={14} className={`shrink-0 text-slate-600 transition-transform group-hover:text-slate-400 ${expandido ? 'rotate-90 text-slate-300' : ''}`} />
                                  </div>
                                  <div className="mt-0.5 font-mono text-xs text-slate-500">{formatarCnpj(i.cnpj)}</div>
                                  {decisor?.nome && (
                                    <div className="mt-1 flex items-center gap-1 text-xs text-indigo-300"><Check size={11} /> {decisor.nome}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className={`px-4 py-4 ${celula}`}>
                              <div className="truncate text-slate-200">{nomeLegivel(i.municipio) || '—'}</div>
                              <div className="mt-0.5 text-xs text-slate-500">{i.uf ?? ''}</div>
                            </td>
                            <td className={`px-4 py-4 ${celula} whitespace-nowrap text-slate-300`}>
                              {rotuloPorte(i.porte)}
                              {i.mei && <span className="chip chip-warning ml-2">MEI</span>}
                            </td>
                            <td className={`px-4 py-4 ${celula}`}>
                              {i.email ? (
                                <>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Mail size={13} className="shrink-0 text-slate-500" />
                                    <span className="min-w-0 truncate text-slate-200" title={i.email}>{i.email}</span>
                                  </div>
                                  <div className={`mt-1 flex items-center gap-1.5 pl-5 text-xs ${COR_QUALIDADE[i.qualidade_email]}`}>
                                    <span className={`h-1.5 w-1.5 rounded-full ${PONTO_QUALIDADE[i.qualidade_email]}`} />
                                    {ROTULO_QUALIDADE[i.qualidade_email]}
                                  </div>
                                </>
                              ) : (
                                <span className="text-sm text-slate-500">Sem e-mail</span>
                              )}
                            </td>
                            <td className={`w-36 px-5 py-4 ${celula} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                              {i.ja_na_base && (
                                i.lead_id
                                  ? <Link href={`/leads/${i.lead_id}`} className="chip chip-success hover:brightness-125"><Check size={11} /> Já na base</Link>
                                  : <span className="chip chip-success"><Check size={11} /> Já na base</span>
                              )}
                            </td>
                          </tr>
                          {expandido && (
                            <tr>
                              <td colSpan={6} className="border-b border-[var(--border)] p-0">
                                <DetalheEmpresa empresa={i} decisor={decisor ?? null} onDecisor={(d) => setDecisores((m) => ({ ...m, [i.cnpj]: d }))} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
              {cursor && (
                <div className="flex justify-center border-t border-[var(--border-subtle)] py-5">
                  <button
                    type="button"
                    onClick={() => buscar(filtros, cursor)}
                    disabled={carregando}
                    className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50 focus-ring"
                  >
                    {carregando ? 'Carregando…' : 'Carregar mais empresas'}
                  </button>
                </div>
              )}
            </section>

            {/* Espaço para a barra flutuante não cobrir o fim da lista. */}
            {selecionados.size > 0 && <div className="h-16" />}
          </>
        )}
      </div>

      {/* Barra de ações da seleção — left-60 = largura do menu lateral. */}
      {selecionados.size > 0 && (
        <div className="pointer-events-none fixed left-60 right-0 bottom-6 z-40 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] py-2.5 pl-5 pr-2.5 shadow-2xl shadow-black/50 animate-in">
            <span className="text-sm text-slate-200">
              <span className="font-semibold tabular-nums">{selecionados.size}</span> selecionada{selecionados.size === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => { setSelecionados(new Map()); setConfirmandoDescarte(false); }} className="text-sm text-slate-400 hover:text-slate-200 focus-ring rounded">
              Limpar
            </button>
            <div className="h-6 w-px bg-[var(--border)]" />
            {confirmandoDescarte ? (
              <button type="button" onClick={descartar} className="flex h-10 items-center gap-2 rounded-lg bg-red-500/15 px-4 text-sm font-medium text-red-300 ring-1 ring-inset ring-red-500/40 hover:bg-red-500/25 focus-ring">
                <Trash2 size={15} /> Confirmar descarte
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmandoDescarte(true)} className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm text-slate-300 hover:bg-white/5 focus-ring" title="Some da busca desta organização">
                <Trash2 size={15} /> Descartar
              </button>
            )}
            <button type="button" onClick={() => setImportando(true)} className="flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] focus-ring">
              <Download size={15} /> Importar {selecionados.size}
            </button>
          </div>
        </div>
      )}

      {importando && (
        <ImportarProspeccaoModal itens={itensImportacao} onFechar={() => setImportando(false)} onImportado={aoImportar} />
      )}
    </div>
  );
}
