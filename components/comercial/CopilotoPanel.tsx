'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, Search, X, Loader2, Check, ClipboardList, AlertTriangle, Target,
  ListChecks, CalendarClock, Mail, ArrowRight, Copy, MessageSquare,
} from 'lucide-react';
import { getLeads, registrarNota, atualizarEstagio, analisarReuniaoCopiloto } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import type { AnaliseReuniao } from '@/lib/ia/copilotoReuniao';
import { PRODUTOS } from '@/lib/simulador';
import { getEstagioPipelineLabel } from '@/lib/utils';
import type { EstagioPipeline } from '@/lib/types';

// Aba "Copiloto" do módulo Comercial. Sem H1/padding próprios — a página
// /comercial provê o cabeçalho e as abas.

const MARCADOR = 'Copiloto pós-reunião:';

export default function CopilotoPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadSel, setLeadSel] = useState<Lead | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const [transcricao, setTranscricao] = useState('');
  const [analisando, setAnalisando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [analise, setAnalise] = useState<AnaliseReuniao | null>(null);

  useEffect(() => { getLeads().then(setLeads).catch(() => setLeads([])); }, []);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = t
      ? leads.filter((l) => l.empresa?.toLowerCase().includes(t) || l.contato_nome?.toLowerCase().includes(t))
      : leads;
    return base.slice(0, 8);
  }, [busca, leads]);

  async function analisar() {
    if (transcricao.trim().length < 20) { setErro('Cole a transcrição da reunião.'); return; }
    setAnalisando(true); setErro(null); setAnalise(null);
    try {
      const r = await analisarReuniaoCopiloto(leadSel?.id ?? null, transcricao);
      setAnalise(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível analisar a reunião.');
    } finally {
      setAnalisando(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Entrada */}
      <div className="card p-5 space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1">Lead (opcional, dá contexto à IA)</label>
          {leadSel ? (
            <div className="flex items-center gap-2 border border-indigo-500/40 bg-indigo-500/5 rounded-lg px-3 py-2">
              <span className="flex-1 text-sm text-slate-200 truncate">{leadSel.empresa}</span>
              <button onClick={() => setLeadSel(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-1.5 border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117]">
                <Search size={14} className="text-slate-500" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} onFocus={() => setAberto(true)}
                  placeholder="Buscar empresa ou contato..." className="flex-1 bg-transparent text-sm text-slate-100 focus:outline-none" />
              </div>
              {aberto && filtrados.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-[#2a3147] bg-[#161b28] shadow-xl">
                  {filtrados.map((l) => (
                    <button key={l.id} onClick={() => { setLeadSel(l); setAberto(false); setBusca(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-[#0f1117] text-sm text-slate-200 border-b border-[#2a3147] last:border-0">
                      <div className="truncate">{l.empresa}</div>
                      <div className="text-xs text-slate-500 truncate">{l.contato_nome}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-slate-300 block mb-1">Transcrição</label>
          <textarea
            value={transcricao}
            onChange={(e) => setTranscricao(e.target.value)}
            rows={14}
            placeholder="Cole aqui o texto da transcrição do Google Meet..."
            className="w-full text-sm border border-[#2a3147] rounded-lg px-3 py-2 bg-[#0f1117] text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          />
          <div className="text-xs text-slate-600 mt-1">{transcricao.length.toLocaleString('pt-BR')} caracteres</div>
        </div>

        {erro && <p className="text-sm text-red-400">{erro}</p>}

        <button
          onClick={analisar}
          disabled={analisando}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 py-2.5 rounded-lg transition-colors"
        >
          {analisando ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {analisando ? 'Analisando reunião...' : 'Analisar reunião'}
        </button>
      </div>

      {/* Resultado */}
      <div>
        {!analise ? (
          <div className="card p-5 h-full flex flex-col items-center justify-center text-center gap-2 min-h-[300px]">
            <div className="w-10 h-10 rounded-full bg-[#232a3d] flex items-center justify-center">
              <Sparkles size={18} className="text-slate-500" />
            </div>
            <p className="text-sm text-slate-400">A análise aparece aqui</p>
            <p className="text-xs text-slate-600 max-w-[260px]">
              Selecione o lead (opcional), cole a transcrição e clique em Analisar.
            </p>
          </div>
        ) : (
          <Resultado analise={analise} lead={leadSel} />
        )}
      </div>
    </div>
  );
}

function Bloco({ Icon, titulo, children, cor = 'text-indigo-400' }: {
  Icon: typeof Target; titulo: string; children: React.ReactNode; cor?: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} className={cor} />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{titulo}</span>
      </div>
      {children}
    </div>
  );
}

function ListaBullets({ itens, vazio }: { itens: string[]; vazio: string }) {
  if (itens.length === 0) return <p className="text-xs text-slate-600">{vazio}</p>;
  return (
    <ul className="space-y-1">
      {itens.map((t, i) => (
        <li key={i} className="text-sm text-slate-300 flex gap-2">
          <span className="text-slate-600 mt-0.5">•</span><span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Resultado({ analise, lead }: { analise: AnaliseReuniao; lead: Lead | null }) {
  const [registrado, setRegistrado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [estagioAplicado, setEstagioAplicado] = useState(false);
  const [aplicandoEstagio, setAplicandoEstagio] = useState(false);
  const [emailCopiado, setEmailCopiado] = useState(false);

  const nomeProduto = (id: string) => PRODUTOS.find((p) => p.id === id)?.nome ?? id;

  const simuladorHref = analise.equipamentos.length > 0
    ? `/comercial?tab=simulador&modelo=comodato&itens=${analise.equipamentos.map((e) => `${e.produto}:${e.quantidade}`).join(',')}`
    : null;

  function textoRegistro(): string {
    const linhas = [`${MARCADOR} ${analise.resumo}`];
    if (analise.dores.length) linhas.push(`\nDores: ${analise.dores.join('; ')}`);
    if (analise.objecoes.length) linhas.push(`Objeções: ${analise.objecoes.join('; ')}`);
    if (analise.equipamentos.length) linhas.push(`Equipamentos: ${analise.equipamentos.map((e) => `${e.quantidade}x ${nomeProduto(e.produto)}`).join(', ')}`);
    if (analise.proximosPassos.length) linhas.push(`Próximos passos: ${analise.proximosPassos.join('; ')}`);
    if (analise.tarefas.length) linhas.push(`Tarefas: ${analise.tarefas.join('; ')}`);
    if (analise.proximoFollowup) linhas.push(`Próximo follow-up sugerido: ${analise.proximoFollowup}`);
    return linhas.join('\n');
  }

  async function registrar() {
    if (!lead) return;
    setSalvando(true);
    try {
      await registrarNota(lead.id, textoRegistro());
      setRegistrado(true);
    } catch (e) { console.error('Erro ao registrar copiloto:', e); }
    finally { setSalvando(false); }
  }

  async function aplicarEstagio() {
    if (!lead || !analise.estagioSugerido) return;
    setAplicandoEstagio(true);
    try {
      await atualizarEstagio(lead.id, analise.estagioSugerido);
      setEstagioAplicado(true);
    } catch (e) { console.error('Erro ao aplicar estágio:', e); }
    finally { setAplicandoEstagio(false); }
  }

  async function copiarEmail() {
    try {
      await navigator.clipboard.writeText(`Assunto: ${analise.emailAssunto}\n\n${analise.emailCorpo}`);
      setEmailCopiado(true);
      setTimeout(() => setEmailCopiado(false), 3000);
    } catch { /* clipboard indisponível */ }
  }

  return (
    <div className="space-y-3">
      <Bloco Icon={ClipboardList} titulo="Resumo da conversa">
        <p className="text-sm text-slate-300 leading-relaxed">{analise.resumo || '—'}</p>
      </Bloco>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Bloco Icon={AlertTriangle} titulo="Dores e necessidades" cor="text-amber-400">
          <ListaBullets itens={[...analise.dores, ...analise.necessidades]} vazio="Nada identificado." />
        </Bloco>
        <Bloco Icon={MessageSquare} titulo="Objeções" cor="text-red-400">
          <ListaBullets itens={analise.objecoes} vazio="Nenhuma objeção registrada." />
        </Bloco>
      </div>

      <Bloco Icon={Target} titulo="Equipamentos mencionados" cor="text-emerald-400">
        {analise.equipamentos.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhum equipamento identificado.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {analise.equipamentos.map((e, i) => (
                <span key={i} className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300">
                  {e.quantidade}x {nomeProduto(e.produto)}
                </span>
              ))}
            </div>
            {simuladorHref && (
              <Link href={simuladorHref} className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline">
                Abrir no simulador com estes itens <ArrowRight size={11} />
              </Link>
            )}
          </>
        )}
      </Bloco>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Bloco Icon={ListChecks} titulo="Próximos passos">
          <ListaBullets itens={analise.proximosPassos} vazio="—" />
        </Bloco>
        <Bloco Icon={ListChecks} titulo="Tarefas de acompanhamento" cor="text-sky-400">
          <ListaBullets itens={analise.tarefas} vazio="—" />
        </Bloco>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Bloco Icon={ArrowRight} titulo="Estágio sugerido" cor="text-violet-400">
          {analise.estagioSugerido ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">
                {getEstagioPipelineLabel(analise.estagioSugerido as EstagioPipeline)}
              </span>
              {lead && (
                <button
                  onClick={aplicarEstagio}
                  disabled={aplicandoEstagio || estagioAplicado}
                  className="ml-auto text-xs font-semibold px-2 py-1 rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {estagioAplicado ? <><Check size={11} /> Aplicado</> : aplicandoEstagio ? 'Aplicando...' : 'Aplicar'}
                </button>
              )}
            </div>
          ) : <p className="text-xs text-slate-600">Sem sugestão clara.</p>}
        </Bloco>
        <Bloco Icon={CalendarClock} titulo="Próximo follow-up" cor="text-amber-400">
          <p className="text-sm text-slate-300">{analise.proximoFollowup || '—'}</p>
        </Bloco>
      </div>

      <Bloco Icon={Mail} titulo="Rascunho de e-mail de agradecimento" cor="text-indigo-400">
        <div className="text-xs text-slate-500 mb-1">Assunto: <span className="text-slate-300">{analise.emailAssunto || '—'}</span></div>
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-[#0f1117] rounded-lg p-3 border border-[#2a3147]">{analise.emailCorpo || '—'}</p>
        <button onClick={copiarEmail} className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline">
          {emailCopiado ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar e-mail</>}
        </button>
        <p className="text-[11px] text-slate-600 mt-1">A IA não envia — copie, revise e envie você mesmo.</p>
      </Bloco>

      {/* Registrar no lead */}
      <div className="card p-4">
        {lead ? (
          <button
            onClick={registrar}
            disabled={salvando || registrado}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 py-2 rounded-lg transition-colors"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : registrado ? <Check size={14} /> : <ClipboardList size={14} />}
            {registrado ? `Registrado em ${lead.empresa}` : `Registrar análise no lead (${lead.empresa})`}
          </button>
        ) : (
          <p className="text-xs text-slate-500 text-center">Selecione um lead acima para registrar esta análise na timeline dele.</p>
        )}
      </div>
    </div>
  );
}
