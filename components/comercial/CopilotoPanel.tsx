'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles, Search, X, Loader2, Check, ClipboardList, AlertTriangle, Target,
  ListChecks, CalendarClock, Mail, ArrowRight, Copy, MessageSquare, Lightbulb, MessageSquareText,
} from 'lucide-react';
import { getLeads, registrarNota, atualizarEstagio, analisarReuniaoCopiloto } from '@/lib/api';
import type { Lead } from '@/lib/supabase';
import type { AnaliseReuniao } from '@/lib/ia/copilotoReuniao';
import { PRODUTOS } from '@/lib/simulador';
import { getEstagioPipelineLabel } from '@/lib/utils';
import type { EstagioPipeline } from '@/lib/types';
import { estilosModulo as m, TituloSecao } from '@/components/tema/Modulo';
import s from './Comercial.module.css';

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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* Entrada */}
      <section className={m.painel}>
        <div className={m.painelBarra}>
          <TituloSecao icone={MessageSquareText} titulo="Reunião" subtitulo="Cole a transcrição; a IA resume e sugere os próximos passos." />
        </div>
        <div className={s.corpo}>
          <div className={s.rotulo}>
            <span>Lead <em className="font-normal not-italic text-slate-400">(opcional, dá contexto à IA)</em></span>
            {leadSel ? (
              <div className={s.leadEscolhido}>
                <div className="min-w-0 flex-1">
                  <strong className="truncate">{leadSel.empresa}</strong>
                  {leadSel.contato_nome && <small className="truncate">{leadSel.contato_nome}</small>}
                </div>
                <button type="button" onClick={() => setLeadSel(null)} aria-label="Trocar lead" className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-slate-100">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-300" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onFocus={() => setAberto(true)}
                  onBlur={() => setTimeout(() => setAberto(false), 150)}
                  placeholder="Buscar empresa ou contato"
                  aria-label="Buscar lead"
                  className={`${s.campo} ${s.comIcone} focus-ring`}
                />
                {aberto && filtrados.length > 0 && (
                  <div className={s.menuLeads}>
                    {filtrados.map((l) => (
                      <button key={l.id} type="button" onClick={() => { setLeadSel(l); setAberto(false); setBusca(''); }}>
                        <span className="block truncate">{l.empresa}</span>
                        {l.contato_nome && <small className="truncate">{l.contato_nome}</small>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <label className={s.rotulo}>
            <span>Transcrição</span>
            <textarea
              value={transcricao}
              onChange={(e) => setTranscricao(e.target.value)}
              rows={14}
              placeholder="Cole aqui o texto da transcrição do Google Meet..."
              className={`${s.campo} focus-ring`}
            />
          </label>
          <div className={`${s.contador} -mt-2.5`}>{transcricao.length.toLocaleString('pt-BR')} caracteres</div>

          {erro && <p className="flex items-center gap-2 text-sm text-red-300"><AlertTriangle size={14} /> {erro}</p>}

          <button
            type="button"
            onClick={analisar}
            disabled={analisando}
            className={`${m.primaryButton} w-full justify-center focus-ring`}
          >
            {analisando ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {analisando ? 'Analisando reunião...' : 'Analisar reunião'}
          </button>
        </div>
      </section>

      {/* Resultado */}
      <div>
        {!analise ? (
          <section className={m.painel}>
            <div className={m.painelBarra}>
              <TituloSecao icone={Sparkles} titulo="Análise" subtitulo="Resumo, dores, objeções, equipamentos e próximos passos." />
            </div>
            <div className={`${s.vazio} py-10`}>
              <span className={s.vazioIcone}><Sparkles size={20} aria-hidden="true" /></span>
              <strong>A análise aparece aqui</strong>
              <ol className={s.passos}>
                <li><b>1</b> Escolha o lead (opcional)</li>
                <li><b>2</b> Cole a transcrição da reunião</li>
                <li><b>3</b> Clique em Analisar reunião</li>
              </ol>
            </div>
          </section>
        ) : (
          <Resultado analise={analise} lead={leadSel} transcricao={transcricao} />
        )}
      </div>
    </div>
  );
}

const TOM_RGB: Record<string, string> = {
  'text-indigo-400': '129, 140, 248',
  'text-amber-400': '251, 191, 36',
  'text-red-400': '248, 113, 113',
  'text-emerald-400': '52, 211, 153',
  'text-sky-400': '56, 189, 248',
  'text-violet-400': '167, 139, 250',
};

function Bloco({ Icon, titulo, children, cor = 'text-indigo-400' }: {
  Icon: typeof Target; titulo: string; children: React.ReactNode; cor?: string;
}) {
  return (
    <div className={s.bloco} style={{ '--tom-rgb': TOM_RGB[cor] ?? TOM_RGB['text-indigo-400'] } as React.CSSProperties}>
      <div className={s.blocoTitulo}>
        <span><Icon size={13} aria-hidden="true" /></span>
        {titulo}
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

function Resultado({ analise, lead, transcricao }: {
  analise: AnaliseReuniao;
  lead: Lead | null;
  transcricao: string;
}) {
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
    if (analise.lacunasDescoberta.length) linhas.push(`Pontos não tratados: ${analise.lacunasDescoberta.join('; ')}`);
    if (analise.equipamentos.length) linhas.push(`Equipamentos: ${analise.equipamentos.map((e) => `${e.quantidade}x ${nomeProduto(e.produto)} (${e.origem})`).join(', ')}`);
    if (analise.proximosPassos.length) linhas.push(`Próximos passos: ${analise.proximosPassos.join('; ')}`);
    if (analise.tarefas.length) linhas.push(`Tarefas: ${analise.tarefas.join('; ')}`);
    if (analise.proximoFollowup) linhas.push(`Próximo follow-up sugerido: ${analise.proximoFollowup}`);
    const transcricaoLimpa = transcricao.trim();
    if (transcricaoLimpa) linhas.push(`\nTranscrição da reunião:\n${transcricaoLimpa}`);
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

      <Bloco Icon={Target} titulo="Equipamentos avaliados" cor="text-emerald-400">
        {analise.equipamentos.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhum equipamento identificado.</p>
        ) : (
          <>
            <div className="space-y-1.5 mb-2">
              {analise.equipamentos.map((e, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300">
                    {e.quantidade}x {nomeProduto(e.produto)}
                  </span>
                  <span className={e.origem === 'recomendado' ? 'text-amber-300' : 'text-slate-500'}>
                    {e.origem === 'recomendado' ? 'Recomendação do Copiloto' : 'Mencionado na reunião'}
                  </span>
                  {e.justificativa && <span className="w-full text-slate-500">{e.justificativa}</span>}
                </div>
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

      <Bloco Icon={Lightbulb} titulo="Pontos não tratados na reunião" cor="text-amber-400">
        <ListaBullets itens={analise.lacunasDescoberta} vazio="Nenhuma lacuna relevante identificada." />
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
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-[var(--bg-base)] rounded-lg p-3 border border-[var(--border)]">{analise.emailCorpo || '—'}</p>
        <button onClick={copiarEmail} className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline">
          {emailCopiado ? <><Check size={11} /> Copiado</> : <><Copy size={11} /> Copiar e-mail</>}
        </button>
        <p className="text-[11px] text-slate-600 mt-1">A IA não envia — copie, revise e envie você mesmo.</p>
      </Bloco>

      {/* Registrar no lead */}
      <div className={s.bloco}>
        {lead ? (
          <button
            onClick={registrar}
            disabled={salvando || registrado}
            className={`${m.primaryButton} w-full justify-center focus-ring`}
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : registrado ? <Check size={14} /> : <ClipboardList size={14} />}
            {registrado ? `Registrado em ${lead.empresa}` : `Registrar análise e transcrição no lead (${lead.empresa})`}
          </button>
        ) : (
          <p className="text-xs text-slate-500 text-center">Selecione um lead acima para registrar esta análise na timeline dele.</p>
        )}
      </div>
    </div>
  );
}
