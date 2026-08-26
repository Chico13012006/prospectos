'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListTodo,
  MailCheck,
  MessageSquare,
  RefreshCw,
  Send,
  Target,
  Users,
} from 'lucide-react'
import { formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import type { ClienteControleVencimento } from '@/lib/operacao/dashboard'
import type { ObjetivoOperacional } from '@/lib/config/workspaceConfig'

interface ComunicacaoRenovacao {
  id: string
  leadId: string
  empresaId: string | null
  empresa: string
  enviadaEm: string
  origem: string
}

interface ClienteVencimentoDashboard extends ClienteControleVencimento {
  ultimaMensagem: ComunicacaoRenovacao | null
}

interface TarefaDashboard {
  id: string
  leadId: string | null
  cliente: string | null
  titulo: string
  prioridade: string
  prazoEm: string | null
  tipo: string | null
}

interface ResumoDashboard {
  atualizadoEm: string
  antecedenciaDias: number
  operacao: {
    objetivoPrincipal: ObjetivoOperacional
    objetivosAtivos: ObjetivoOperacional[]
    relatorioSemanal: boolean
    metasMensais: { contatos?: number; reunioes?: number; renovacoes?: number }
  }
  resumo: {
    leads: number
    tarefasAbertas: number
    oportAbertas: number
    pipeline: number
    campanhasAtivas: number
    renovacoesJanela: number
    validade: {
      vencidos: number
      proximos30: number
      entre31e60: number
      proximos60: number
      totalComData: number
      servicos: number
      legados: number
    }
  }
  prospeccao: {
    novos: number
    clientesContatados: number
    mensagensEnviadas: number
    respostas: number
    reunioes: number
  }
  renovacoes: {
    renovadosMes: number
    empresas: {
      vencidas: number
      proximos30: number
      entre31e60: number
      proximos60: number
      totalMonitoradas: number
    }
    comunicacoes: ComunicacaoRenovacao[]
  }
  metasAtuais: { contatos: number; reunioes: number; renovacoes: number }
  vencimentos: ClienteVencimentoDashboard[]
  tarefas: TarefaDashboard[]
}

const ROTULO_OBJETIVO: Record<ObjetivoOperacional, string> = {
  prospeccao: 'Prospecção',
  vencimentos_laudos: 'Vencimentos e renovações',
}

function Kpi({ label, valor, Icon, cor, detalhe }: {
  label: string
  valor: number
  Icon: typeof Users
  cor: string
  detalhe?: string
}) {
  return (
    <div className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500"><Icon size={14} className={cor} /> {label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${cor}`}>{valor.toLocaleString('pt-BR')}</div>
      {detalhe && <p className="mt-1 text-xs text-slate-600">{detalhe}</p>}
    </div>
  )
}

function MetaCard({ label, atual, meta, cor }: { label: string; atual: number; meta?: number; cor: string }) {
  const percentual = meta ? Math.min(100, Math.round((atual / meta) * 100)) : 0
  return (
    <div className="rounded-lg border border-[#2a3147] bg-[#0f1117] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-bold text-slate-100">
            {atual.toLocaleString('pt-BR')}{meta ? <span className="text-sm font-normal text-slate-500"> / {meta.toLocaleString('pt-BR')}</span> : null}
          </p>
        </div>
        <span className={`text-xs font-semibold ${meta ? cor : 'text-slate-600'}`}>{meta ? `${percentual}%` : 'Sem meta'}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#252b3b]">
        <div className={`h-full rounded-full ${cor.replace('text-', 'bg-')}`} style={{ width: `${percentual}%` }} />
      </div>
    </div>
  )
}

function statusVisual(status: ClienteControleVencimento['status']) {
  if (status === 'vencido') return { label: 'Vencido', cls: 'bg-rose-500/15 text-rose-400' }
  if (status === 'critico') return { label: 'Crítico', cls: 'bg-red-500/15 text-red-400' }
  if (status === 'atencao') return { label: 'Atenção', cls: 'bg-amber-500/15 text-amber-400' }
  return { label: 'No prazo', cls: 'bg-emerald-500/15 text-emerald-400' }
}

function prazoHumano(dias: number) {
  if (dias < 0) return `${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'} vencido`
  if (dias === 0) return 'Vence hoje'
  return `${dias} dia${dias === 1 ? '' : 's'}`
}

function formatarPrazoTarefa(valor: string | null) {
  if (!valor) return 'Sem prazo'
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return 'Sem prazo'
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatarDataHora(valor: string) {
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return 'Data indisponível'
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ProximasAcoes({ tarefas, titulo }: { tarefas: TarefaDashboard[]; titulo: string }) {
  return (
    <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Clock3 size={16} className="text-cyan-400" /> {titulo}</h2>
        <Link href="/automacao?tab=execucoes" className="text-xs text-indigo-400 hover:underline">Ver todas</Link>
      </div>
      {tarefas.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">Nenhuma tarefa aberta neste módulo.</div>
      ) : (
        <div className="mt-4 space-y-2">
          {tarefas.map((tarefa) => {
            const conteudo = (
              <div className="flex items-center gap-3 rounded-lg border border-[#2a3147] p-3 transition-colors hover:bg-[#0f1117]">
                <ListTodo size={15} className={tarefa.prioridade === 'alta' ? 'text-rose-400' : 'text-cyan-400'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{tarefa.titulo}</p>
                  {tarefa.cliente && <p className="truncate text-xs text-slate-500">{tarefa.cliente}</p>}
                </div>
                <span className="text-xs text-slate-500">{formatarPrazoTarefa(tarefa.prazoEm)}</span>
              </div>
            )
            return tarefa.leadId
              ? <Link key={tarefa.id} href={`/leads/${tarefa.leadId}`}>{conteudo}</Link>
              : <div key={tarefa.id}>{conteudo}</div>
          })}
        </div>
      )}
    </section>
  )
}

function PainelProspeccao({ dados }: { dados: ResumoDashboard }) {
  const metas = dados.operacao.metasMensais
  const tarefas = dados.tarefas.filter((tarefa) => tarefa.tipo !== 'renovacao')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Dashboard de prospecção</h2>
        <p className="mt-0.5 text-sm text-slate-500">Aquisição, contatos, respostas e avanço comercial dos últimos 30 dias.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Novos leads" valor={dados.prospeccao.novos} Icon={Users} cor="text-indigo-400" detalhe="Últimos 30 dias" />
        <Kpi label="Clientes contatados" valor={dados.prospeccao.clientesContatados} Icon={Send} cor="text-cyan-400" detalhe="Últimos 30 dias" />
        <Kpi label="Mensagens enviadas" valor={dados.prospeccao.mensagensEnviadas} Icon={MailCheck} cor="text-sky-400" detalhe="Abordagens e follow-ups" />
        <Kpi label="Respostas recebidas" valor={dados.prospeccao.respostas} Icon={MessageSquare} cor="text-emerald-400" detalhe="Últimos 30 dias" />
        <Kpi label="Reuniões agendadas" valor={dados.prospeccao.reunioes} Icon={CalendarCheck} cor="text-violet-400" detalhe="Últimos 30 dias" />
        <Kpi label="Tarefas comerciais" valor={tarefas.length} Icon={ListTodo} cor="text-amber-400" detalhe="Próximas ações visíveis" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5 xl:col-span-3">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Target size={16} className="text-indigo-400" /> Metas de prospecção</h2>
          <p className="mt-1 text-xs text-slate-500">Resultados reais do mês. Campos sem meta não geram progresso artificial.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <MetaCard label="Empresas contatadas" atual={dados.metasAtuais.contatos} meta={metas.contatos} cor="text-emerald-400" />
            <MetaCard label="Reuniões agendadas" atual={dados.metasAtuais.reunioes} meta={metas.reunioes} cor="text-violet-400" />
          </div>
        </section>

        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5 xl:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><BriefcaseBusiness size={16} className="text-cyan-400" /> Resumo comercial</h2>
          <dl className="mt-4 divide-y divide-[#2a3147] text-sm">
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Oportunidades abertas</dt><dd className="font-semibold text-slate-200">{dados.resumo.oportAbertas.toLocaleString('pt-BR')}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Pipeline</dt><dd className="font-semibold text-slate-200">{dados.resumo.pipeline.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Campanhas ativas</dt><dd className="font-semibold text-slate-200">{dados.resumo.campanhasAtivas.toLocaleString('pt-BR')}</dd></div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><AlertTriangle size={16} className="text-amber-400" /> Alertas de prospecção</h2>
          <div className="mt-4">
            {dados.prospeccao.clientesContatados > 0 && dados.prospeccao.respostas === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-sky-500/20 bg-sky-500/10 p-3">
                <MessageSquare size={16} className="shrink-0 text-sky-400" />
                <span className="text-sm text-slate-300">Há contatos no período, mas nenhuma resposta registrada.</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="text-sm text-slate-300">Nenhum alerta crítico de prospecção com os dados atuais.</span>
              </div>
            )}
          </div>
        </section>
        <ProximasAcoes tarefas={tarefas} titulo="Próximas ações comerciais" />
      </div>
    </div>
  )
}

function PainelRenovacoes({ dados }: { dados: ResumoDashboard }) {
  const metas = dados.operacao.metasMensais
  const empresas = dados.renovacoes.empresas
  const tarefas = dados.tarefas.filter((tarefa) => tarefa.tipo === 'renovacao')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Dashboard de vencimentos e renovações</h2>
        <p className="mt-0.5 text-sm text-slate-500">Empresas únicas classificadas pela validade mais urgente dos seus laudos.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Empresas vencidas" valor={empresas.vencidas} Icon={AlertTriangle} cor="text-rose-400" detalhe="Exigem contato imediato" />
        <Kpi label="Próximos 30 dias" valor={empresas.proximos30} Icon={CalendarClock} cor="text-amber-400" detalhe="Empresas com renovação próxima" />
        <Kpi label="De 31 a 60 dias" valor={empresas.entre31e60} Icon={CalendarCheck} cor="text-cyan-400" detalhe="Segunda janela de preparação" />
        <Kpi label="Renovadas neste mês" valor={dados.renovacoes.renovadosMes} Icon={CheckCircle2} cor="text-emerald-400" detalhe="Renovações registradas" />
      </div>

      <section className="overflow-hidden rounded-xl border border-[#2a3147] bg-[#1a1f2e]">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a3147] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><CalendarClock size={16} className="text-cyan-400" /> Fila de vencimentos e renovações</h2>
            <p className="mt-1 text-xs text-slate-500">Um cliente por linha; múltiplos laudos são reunidos e a mensagem real mais recente fica visível.</p>
          </div>
          <Link href="/base-leads" className="shrink-0 text-xs text-indigo-400 hover:underline">Ver base <ArrowRight className="inline" size={11} /></Link>
        </div>
        {dados.vencimentos.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={24} />
            <p className="mt-2 text-sm font-medium text-slate-300">Nenhum vencimento cadastrado</p>
            <p className="mt-1 text-xs text-slate-500">Cadastre a validade no cliente para formar a fila de renovação.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-[#2a3147] text-[11px] uppercase tracking-wide text-slate-600">
                  <th className="w-[22%] px-5 py-3 text-left font-medium">Cliente</th>
                  <th className="w-[19%] px-3 py-3 text-left font-medium">Laudo(s)</th>
                  <th className="w-[14%] px-3 py-3 text-left font-medium">Vencimento</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Prazo</th>
                  <th className="w-[20%] px-3 py-3 text-left font-medium">Mensagem de renovação</th>
                  <th className="w-[13%] px-5 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {dados.vencimentos.map((item) => {
                  const visual = statusVisual(item.status)
                  return (
                    <tr key={item.chave} className="border-b border-[#2a3147]/60 transition-colors last:border-0 hover:bg-[#0f1117]">
                      <td className="truncate px-5 py-3 font-medium text-slate-200" title={item.empresa}>
                        {item.leadId
                          ? <Link href={`/leads/${item.leadId}`} className="hover:text-cyan-300 hover:underline">{item.empresa}</Link>
                          : item.empresa}
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-slate-400">
                        <span className="line-clamp-1">{item.motivos.map((motivo) => motivo.tipo).join(', ')}</span>
                        {item.motivos.length > 1 && <span className="text-[11px] text-cyan-500">{item.motivos.length} vencimentos agrupados</span>}
                      </td>
                      <td className="px-3 py-3 text-slate-300">{formatarDataIsoSemFuso(item.vencimentoMaisProximo)}</td>
                      <td className="px-3 py-3 text-slate-400">{prazoHumano(item.diasRestantes)}</td>
                      <td className="px-3 py-3">
                        {item.ultimaMensagem ? (
                          <div title={item.ultimaMensagem.origem}>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400"><MailCheck size={11} /> Enviada</span>
                            <p className="mt-1 text-[11px] text-slate-600">{formatarDataHora(item.ultimaMensagem.enviadaEm)}</p>
                          </div>
                        ) : <span className="text-xs text-slate-600">Nenhum envio real</span>}
                      </td>
                      <td className="px-5 py-3 text-right"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${visual.cls}`}>{visual.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2a3147] px-5 py-3 text-xs text-slate-500">
          <span>{empresas.totalMonitoradas.toLocaleString('pt-BR')} empresas · {dados.resumo.validade.totalComData.toLocaleString('pt-BR')} laudos monitorados</span>
          <Link href="/automacao/campanhas/nova?tipo=renovacao" className="font-medium text-cyan-400 hover:underline">Criar campanha de renovação <ArrowRight className="inline" size={11} /></Link>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="overflow-hidden rounded-xl border border-[#2a3147] bg-[#1a1f2e] xl:col-span-3">
          <div className="border-b border-[#2a3147] px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><MailCheck size={16} className="text-emerald-400" /> Empresas já comunicadas</h2>
            <p className="mt-1 text-xs text-slate-500">Somente mensagens de renovação efetivamente enviadas; ensaios não entram.</p>
          </div>
          {dados.renovacoes.comunicacoes.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma mensagem real de renovação registrada.</div>
          ) : (
            <div className="divide-y divide-[#2a3147]">
              {dados.renovacoes.comunicacoes.map((item) => (
                <Link key={item.id} href={`/leads/${item.leadId}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[#0f1117]">
                  <MailCheck size={15} className="shrink-0 text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{item.empresa}</p>
                    <p className="truncate text-xs text-slate-500">{item.origem}</p>
                  </div>
                  <time className="shrink-0 text-xs text-slate-500" dateTime={item.enviadaEm}>{formatarDataHora(item.enviadaEm)}</time>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5 xl:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><Target size={16} className="text-indigo-400" /> Meta de renovação</h2>
          <p className="mt-1 text-xs text-slate-500">Resultado real do mês contra a meta cadastrada.</p>
          <div className="mt-4">
            <MetaCard label="Laudos renovados" atual={dados.metasAtuais.renovacoes} meta={metas.renovacoes} cor="text-cyan-400" />
          </div>
          <dl className="mt-4 divide-y divide-[#2a3147] text-sm">
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Empresas até 60 dias</dt><dd className="font-semibold text-slate-200">{empresas.proximos60.toLocaleString('pt-BR')}</dd></div>
            <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Antecedência operacional</dt><dd className="font-semibold text-slate-200">{dados.antecedenciaDias} dias</dd></div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-100"><AlertTriangle size={16} className="text-amber-400" /> Alertas de renovação</h2>
          <div className="mt-4 space-y-2">
            {empresas.vencidas > 0 && (
              <Link href="/base-leads" className="flex items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 hover:bg-rose-500/15">
                <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                <span className="flex-1 text-sm text-slate-300"><strong>{empresas.vencidas}</strong> {empresas.vencidas === 1 ? 'empresa está vencida' : 'empresas estão vencidas'} e deve ser priorizada.</span>
                <ArrowRight size={13} className="text-rose-400" />
              </Link>
            )}
            {empresas.proximos30 > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <CalendarClock size={16} className="shrink-0 text-amber-400" />
                <span className="text-sm text-slate-300"><strong>{empresas.proximos30}</strong> {empresas.proximos30 === 1 ? 'empresa entra' : 'empresas entram'} na janela dos próximos 30 dias.</span>
              </div>
            )}
            {empresas.vencidas === 0 && empresas.proximos30 === 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="text-sm text-slate-300">Nenhuma renovação crítica com os dados atuais.</span>
              </div>
            )}
          </div>
        </section>
        <ProximasAcoes tarefas={tarefas} titulo="Próximas ações de renovação" />
      </div>
    </div>
  )
}

export default function DashboardWidgets() {
  const [dados, setDados] = useState<ResumoDashboard | null>(null)
  const [aba, setAba] = useState<ObjetivoOperacional | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/api/dashboard/resumo', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json())?.erro || 'Não foi possível carregar o painel.')
      setDados(await res.json())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o painel')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const abas = useMemo(() => dados?.operacao.objetivosAtivos ?? [], [dados])

  if (carregando && !dados) {
    return (
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded-lg bg-[#1a1f2e]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-[#1a1f2e]" />)}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-[#1a1f2e]" />
      </div>
    )
  }

  if (!dados || erro) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <CircleAlert className="mx-auto text-red-400" size={24} />
        <h2 className="mt-3 font-semibold text-slate-100">Painel indisponível</h2>
        <p className="mt-1 text-sm text-slate-500">{erro || 'Não foi possível carregar os dados.'}</p>
        <button type="button" onClick={carregar} className="mt-4 rounded-lg border border-[#2a3147] px-3 py-2 text-sm text-slate-300 hover:bg-[#1a1f2e]">Tentar novamente</button>
      </div>
    )
  }

  const abaAtiva = aba && abas.includes(aba)
    ? aba
    : abas.includes(dados.operacao.objetivoPrincipal)
      ? dados.operacao.objetivoPrincipal
      : abas[0]
  const atualizado = new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center rounded-lg border border-[#2a3147] bg-[#1a1f2e] p-0.5" aria-label="Módulo do dashboard">
          {abas.map((item) => (
            <button key={item} type="button" onClick={() => setAba(item)} aria-pressed={abaAtiva === item}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${abaAtiva === item ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-200'}`}>
              {ROTULO_OBJETIVO[item]}
            </button>
          ))}
        </div>
        <button type="button" onClick={carregar} disabled={carregando}
          className="inline-flex items-center gap-2 rounded-lg border border-[#2a3147] bg-[#1a1f2e] px-3 py-2 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50">
          <RefreshCw size={12} className={carregando ? 'animate-spin' : ''} /> Atualizado às {atualizado}
        </button>
      </div>

      {abaAtiva === 'vencimentos_laudos'
        ? <PainelRenovacoes dados={dados} />
        : <PainelProspeccao dados={dados} />}
    </div>
  )
}
