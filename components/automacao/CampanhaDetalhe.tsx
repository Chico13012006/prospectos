'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronRight, Loader2, PencilLine, Play, Pause, CheckCircle2, Building2, Users,
  MessageSquare, BarChart3, ClipboardList, Workflow, TrendingUp, Info, Target, AlertTriangle, Activity, CalendarDays,
} from 'lucide-react';
import { type Campanha, type Publico, STATUS_BADGE, STATUS_LABEL, fmtData, resumoPublico } from './tiposCampanha';
import {
  NAO_CONFIGURADO,
  formatarCadenciaOperacional,
  formatarMensagensOperacionais,
  formatarPublicoOperacional,
  formatarRegraResposta,
  formatarStatusOperacional,
  proximaAcaoOperacional,
  type ContextoResumoOperacional,
} from '@/lib/campanhas/resumoOperacional';
import { DIAS_CAMPANHA, normalizarDiasCampanha, type DiaCampanha } from '@/lib/campanhas/agenda';
import { campanhaEhDisparoUnico } from '@/lib/campanhas/configuracaoGuiada';

// Detalhe de campanha com abas internas. Visão geral/Empresas/Decisores/Mensagens
// mostram o que REALMENTE persiste (colunas + publico jsonb + workflow vinculado).
// Resultados mantém "não calculável" enquanto não houver agregação confiável de
// execuções, respostas e oportunidades por campanha. NUNCA estima um valor.

type Aba = 'geral' | 'empresas' | 'decisores' | 'mensagens' | 'resultados';
const ABAS: { id: Aba; label: string; Icon: typeof Building2 }[] = [
  { id: 'geral', label: 'Visão geral', Icon: ClipboardList },
  { id: 'empresas', label: 'Empresas', Icon: Building2 },
  { id: 'decisores', label: 'Decisores', Icon: Users },
  { id: 'mensagens', label: 'Mensagens', Icon: MessageSquare },
  { id: 'resultados', label: 'Resultados', Icon: BarChart3 },
];

const ACOES: Record<string, { para: string; label: string; Icon: typeof Play }[]> = {
  rascunho: [],
  ativa: [{ para: 'pausada', label: 'Pausar', Icon: Pause }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  pausada: [{ para: 'ativa', label: 'Retomar', Icon: Play }, { para: 'concluida', label: 'Concluir', Icon: CheckCircle2 }],
  concluida: [],
};

const card = 'bg-[#1a1f2e] border border-[#2a3147] rounded-xl p-5';
const NC = <span className="text-slate-500">não calculável</span>;

export default function CampanhaDetalhe({ id }: { id: string }) {
  const [c, setC] = useState<Campanha | null>(null);
  const [contextoResumo, setContextoResumo] = useState<ContextoResumoOperacional>({ remetente: null, responsavel: null, workflow: null });
  const [previaPublico, setPreviaPublico] = useState<{ totalSelecionado: number; elegiveis: number } | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [aba, setAba] = useState<Aba>('geral');
  const [agindo, setAgindo] = useState(false);
  const [modalDryRun, setModalDryRun] = useState(false);
  const [modalAgenda, setModalAgenda] = useState(false);
  const [diasAgenda, setDiasAgenda] = useState<DiaCampanha[]>([]);
  const [salvandoAgenda, setSalvandoAgenda] = useState(false);
  const [erroAgenda, setErroAgenda] = useState<string | null>(null);
  const [confirmacaoTexto, setConfirmacaoTexto] = useState('');
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/campanhas/${id}`);
      if (!r.ok) { setEstado('erro'); return; }
      const d = await r.json();
      setC(d.campanha);
      setContextoResumo(d.resumoOperacional ?? { remetente: null, responsavel: null, workflow: null });
      setPreviaPublico(d.previaPublico ?? null);
      setEstado('ok');
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

  async function ativarEnvioReal() {
    if (confirmacaoTexto !== 'CONFIRMAR') return;
    setAgindo(true);
    setErroAcao(null);
    try {
      const resposta = await fetch(`/api/campanhas/${id}/enrollar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmarQuantidade: previaPublico?.elegiveis }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível ativar o envio real.');
      setModalDryRun(false);
      setConfirmacaoTexto('');
      await carregar();
      if (dados.falhas > 0) {
        setErroAcao(`${dados.falhas} contato(s) não puderam ser inscritos; revise as execuções antes de continuar.`);
      }
    } catch (e) {
      setErroAcao(e instanceof Error ? e.message : 'Não foi possível ativar o envio real.');
    } finally { setAgindo(false); }
  }

  function abrirAgenda() {
    setDiasAgenda(normalizarDiasCampanha(c?.publico?.agenda?.diasSemana));
    setErroAgenda(null);
    setModalAgenda(true);
  }

  function alternarDiaAgenda(dia: DiaCampanha) {
    setDiasAgenda((atuais) => atuais.includes(dia)
      ? atuais.filter((item) => item !== dia)
      : DIAS_CAMPANHA.map((item) => item.id).filter((item) => [...atuais, dia].includes(item)));
  }

  async function salvarAgenda() {
    if (!diasAgenda.length) {
      setErroAgenda('Escolha ao menos um dia de execução.');
      return;
    }
    setSalvandoAgenda(true);
    setErroAgenda(null);
    try {
      const resposta = await fetch(`/api/campanhas/${id}/agenda`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diasSemana: diasAgenda }),
      });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível atualizar a agenda.');
      await carregar();
      setModalAgenda(false);
    } catch (e) {
      setErroAgenda(e instanceof Error ? e.message : 'Não foi possível atualizar a agenda.');
    } finally {
      setSalvandoAgenda(false);
    }
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
  const disparoUnico = campanhaEhDisparoUnico(c.tipo) || pub.operacao?.modoEnvio === 'disparo_unico';

  const emEnsaio = c.dry_run !== false;
  const publicoOperacional = previaPublico
    ? `${previaPublico.elegiveis} elegíveis de ${previaPublico.totalSelecionado} selecionados — ${formatarPublicoOperacional(c.publico)}`
    : formatarPublicoOperacional(c.publico);
  const mensagensOperacionais = formatarMensagensOperacionais(contextoResumo.workflow?.definicao ?? null, pub.operacao);
  const cadenciaOperacional = disparoUnico
    ? 'Disparo único — somente a mensagem inicial'
    : formatarCadenciaOperacional(contextoResumo.workflow, pub.agenda, pub.operacao);
  const regraResposta = disparoUnico
    ? 'Encaminhar resposta ao responsável'
    : formatarRegraResposta(pub.operacao?.resposta?.pararCadencia ?? pub.agenda?.pararAoResponder);
  const statusOperacional = formatarStatusOperacional(c.status, c.dry_run);
  const proximaAcao = disparoUnico
    ? c.status === 'rascunho'
      ? 'Revisar e disparar comunicação'
      : c.status === 'ativa' && c.dry_run !== false
        ? 'Confirmar disparo real'
        : c.status === 'ativa'
          ? 'Aguardar processamento do disparo'
          : c.status === 'pausada'
            ? 'Retomar disparo'
            : 'Nenhuma ação pendente'
    : proximaAcaoOperacional(c.status, c.dry_run, c.workflow_id);

  return (
    <div className="p-6 max-w-[100rem] mx-auto space-y-5">
      {/* Banner dry_run */}
      {emEnsaio ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <AlertTriangle size={15} className="shrink-0" />
            <span><b>Modo ensaio ativo</b> — nenhum e-mail real está sendo enviado e nenhuma execução real é criada por esta revisão.</span>
          </div>
          {c.status === 'ativa' && (
            <button
              onClick={() => { setModalDryRun(true); setConfirmacaoTexto(''); setErroAcao(null); }}
              disabled={!previaPublico?.elegiveis}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ativar envio real
            </button>
          )}
        </div>
      ) : (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${c.status === 'ativa' ? 'border-green-500/25 bg-green-500/10 text-green-300' : 'border-slate-500/25 bg-slate-500/10 text-slate-300'}`}>
          {c.status === 'ativa' ? <CheckCircle2 size={15} className="shrink-0" /> : <Info size={15} className="shrink-0" />}
          {c.status === 'ativa' ? (
            disparoUnico
              ? <span><b>Disparo em processamento</b> — somente o público confirmado receberá esta mensagem; não há recorrência.</span>
              : <span><b>Envio real ativo</b> — o próximo ciclo pode avançar os contatos inscritos se hoje estiver na agenda.</span>
          ) : c.status === 'pausada' ? (
            <span><b>Campanha pausada</b> — as execuções estão preservadas, mas nenhuma ação será processada até a retomada.</span>
          ) : c.status === 'concluida' ? (
            disparoUnico
              ? <span><b>Disparo concluído</b> — o público confirmado já saiu da fila ativa e não existe recorrência.</span>
              : <span><b>Campanha concluída</b> — novos contatos não serão inscritos; execuções já iniciadas ainda podem terminar.</span>
          ) : (
            <span><b>Envio real configurado</b> — publique a campanha para iniciar o processamento.</span>
          )}
        </div>
      )}

      {erroAcao && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erroAcao}
        </div>
      )}

      {/* Modal de confirmação dry_run → real */}
      {modalDryRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1a1f2e] border border-red-500/30 rounded-2xl p-7 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={20} />
              <h2 className="text-lg font-bold">Ativar envio real</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Esta ação recalcula o público, desativa o modo ensaio e inscreve <b>{previaPublico?.elegiveis ?? 'um número não calculado de'} contatos elegíveis</b> no workflow. A partir daí, e-mails reais poderão ser enviados pelo cron existente.<br /><br />
              Para confirmar, digite exatamente <code className="bg-red-500/20 text-red-300 px-1 rounded">CONFIRMAR</code> no campo abaixo.
            </p>
            <input
              type="text"
              value={confirmacaoTexto}
              onChange={(e) => setConfirmacaoTexto(e.target.value)}
              placeholder="CONFIRMAR"
              className="w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2.5 text-slate-100 text-sm placeholder-slate-600 focus:outline-none focus:border-red-500/60"
              autoFocus
            />
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setModalDryRun(false); setConfirmacaoTexto(''); }}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg border border-[#2a3147] text-slate-300 hover:bg-[#0f1117] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={ativarEnvioReal}
                disabled={confirmacaoTexto !== 'CONFIRMAR' || agindo}
                className="flex-1 text-sm px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
              >
                {agindo ? <Loader2 size={14} className="animate-spin" /> : null}
                Confirmar e ativar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edição restrita de campanha ativa: somente os próximos dias de execução. */}
      {modalAgenda && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-5 rounded-2xl border border-indigo-500/30 bg-[#1a1f2e] p-7 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-indigo-500/15 p-2 text-indigo-300"><CalendarDays size={20} /></span>
              <div>
                <h2 className="text-lg font-bold text-slate-100">Editar dias de execução</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                  A mesma campanha continuará ativa, com o mesmo público, mensagens e versão publicada. A alteração vale para os próximos ciclos do processador.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-300">Dias permitidos</label>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {DIAS_CAMPANHA.map((dia) => {
                  const selecionado = diasAgenda.includes(dia.id);
                  return (
                    <button
                      key={dia.id}
                      type="button"
                      onClick={() => alternarDiaAgenda(dia.id)}
                      aria-pressed={selecionado}
                      className={`rounded-lg border px-2 py-2.5 text-xs font-semibold transition-colors ${selecionado ? 'border-indigo-500 bg-indigo-500/15 text-indigo-200' : 'border-[#30384e] text-slate-500 hover:text-slate-300'}`}
                    >
                      {dia.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-amber-300/90">
                Salvar não dispara e-mails imediatamente. O processamento acontece no próximo ciclo diário configurado no servidor.
              </p>
            </div>

            {erroAgenda && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {erroAgenda}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setModalAgenda(false)}
                disabled={salvandoAgenda}
                className="flex-1 rounded-lg border border-[#2a3147] px-4 py-2.5 text-sm text-slate-300 transition-colors hover:bg-[#0f1117] disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarAgenda}
                disabled={salvandoAgenda || !diasAgenda.length}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {salvandoAgenda ? <Loader2 size={14} className="animate-spin" /> : <CalendarDays size={14} />}
                Salvar agenda
              </button>
            </div>
          </div>
        </div>
      )}

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
          {!disparoUnico && (c.status === 'ativa' || c.status === 'pausada') && (
            <button
              type="button"
              onClick={abrirAgenda}
              disabled={agindo}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-40"
            >
              <CalendarDays size={14} /> Editar agenda
            </button>
          )}
          {(ACOES[c.status] ?? []).map(({ para, label, Icon }) => (
            <button key={para} onClick={() => transicionar(para)} disabled={agindo}
              className="text-sm px-3 py-2 rounded-lg border border-[#2a3147] text-slate-200 hover:bg-[#0f1117] disabled:opacity-40 inline-flex items-center gap-1">
              <Icon size={14} /> {label}
            </button>
          ))}
          {c.status === 'rascunho' && (
            <Link href={`/automacao/campanhas/${c.id}/editar`}
              className="text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-500 inline-flex items-center gap-1">
              <PencilLine size={14} /> Revisar e publicar
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
        <div className="space-y-5">
          <div className={card}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-semibold text-slate-200 text-sm flex items-center gap-2">
                  <Activity size={15} className="text-indigo-400" /> Resumo operacional
                </h3>
                <p className="text-xs text-slate-500 mt-1">Leitura da configuração real atualmente vinculada à campanha.</p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-slate-500 border border-[#2a3147] rounded-full px-2 py-1">Somente leitura</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Linha k="Público" v={publicoOperacional} />
              <Linha k="Remetente" v={contextoResumo.remetente ?? NAO_CONFIGURADO} />
              <Linha k="Responsável" v={contextoResumo.responsavel ?? NAO_CONFIGURADO} />
              <Linha k="Mensagens" v={mensagensOperacionais} />
              <Linha k={disparoUnico ? 'Envio' : 'Cadência'} v={cadenciaOperacional} />
              <Linha k="Regra de resposta" v={regraResposta} />
              <Linha k="Status" v={statusOperacional} />
              <Linha k="Próxima ação" v={proximaAcao} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className={card}>
              <h3 className="font-semibold text-slate-200 text-sm mb-3">Dados</h3>
              <div className="space-y-2 text-sm">
                <Linha k="Tipo" v={c.tipo ?? '—'} />
                <Linha k="Objetivo" v={pub.objetivo ?? c.descricao ?? '—'} />
                <Linha k="Responsável" v={contextoResumo.responsavel ?? '—'} />
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
                <Linha k="Cadência" v={contextoResumo.workflow?.nome ?? (c.workflow_id ? 'workflow vinculado' : '— (sem workflow)')} />
                <Linha k="Criada em" v={fmtData(c.criado_em)} />
                <Linha k="Iniciada em" v={fmtData(c.iniciada_em)} />
                <Linha k="Concluída em" v={fmtData(c.concluida_em)} />
              </div>
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
            <span>O público efetivo é recalculado no servidor ao ativar e exclui contatos bloqueados, duplicados ou incompatíveis com outra automação.</span>
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
          <h3 className="font-semibold text-slate-200 text-sm mb-3 flex items-center gap-2"><Workflow size={15} className="text-indigo-400" /> {disparoUnico ? 'Mensagem do disparo' : 'Cadência de mensagens'}</h3>
          {c.workflow_id ? (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#2a3147] bg-[#0f1117]">
              <span className="text-sm text-slate-200 inline-flex items-center gap-2"><Workflow size={15} className="text-indigo-400" /> {contextoResumo.workflow?.nome ?? 'Workflow vinculado'}</span>
              <Link href={`/workflows/${c.workflow_id}`} className="text-xs text-indigo-300 hover:text-indigo-200">Abrir no builder →</Link>
            </div>
          ) : (
            <div className="text-sm text-slate-500 bg-[#0f1117] border border-[#2a3147] rounded-lg p-4">
              {disparoUnico ? 'Nenhuma mensagem materializada para este disparo.' : 'Nenhuma cadência vinculada. Edite a campanha e escolha um workflow na etapa Cadência.'}
            </div>
          )}
          <p className="text-xs text-slate-600 mt-3">As mensagens editadas na campanha são materializadas em templates reais e congeladas na versão publicada do workflow.</p>
        </div>
      )}

      {aba === 'resultados' && (
        <div className="space-y-5">
          <div className="flex items-start gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg p-3">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span><b>Resultados agregados por campanha ainda não são calculáveis nesta tela.</b> As execuções já registram a campanha de origem, mas não existe agregação confiável de entregas, respostas e oportunidades. Até lá, nenhum número é estimado.</span>
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
