'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Search,
  Send,
  Target,
  UserRound,
  Users,
} from 'lucide-react'
import { formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import type { ClienteControleVencimento, SituacaoRenovacao } from '@/lib/operacao/dashboard'
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
  ultimaRespostaEm: string | null
  ultimoContato: string | null
  proximaAcaoEm: string | null
  situacao: SituacaoRenovacao
  responsavel: { id: string | null; nome: string } | null
  campanha: { id: string; nome: string } | null
  execucao: {
    id: string
    status: string
    iniciadaEm: string
    atualizadaEm: string
    proximaVerificacaoEm: string | null
  } | null
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

interface AtividadeProspeccaoDashboard {
  id: string
  leadId: string
  empresa: string
  tipo: string
  canal: string | null
  descricao: string | null
  realizadaEm: string
}

interface ResumoDashboard {
  atualizadoEm: string
  antecedenciaDias: number
  visaoProspeccao: {
    modo: 'equipe' | 'individual'
    podeVerEquipe: boolean
    responsavel: { authId: string; id: string; nome: string } | null
    responsaveis: { authId: string; nome: string }[]
  }
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
    atividades: AtividadeProspeccaoDashboard[]
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
    situacoes: Record<SituacaoRenovacao, number>
  }
  metasAtuais: { contatos: number; reunioes: number; renovacoes: number }
  vencimentos: ClienteVencimentoDashboard[]
  tarefas: TarefaDashboard[]
}

const ROTULO_OBJETIVO: Record<ObjetivoOperacional, string> = {
  prospeccao: 'Prospecção',
  vencimentos_laudos: 'Vencimentos e renovações',
}

type JanelaRenovacao = 'todas' | 'vencidas' | 'ate_30' | 'de_31_a_60'
type FiltroSituacaoRenovacao = 'todas' | 'pendentes' | 'agendadas' | 'comunicadas' | 'respondidas' | 'erros'

const ROTULO_SITUACAO: Record<SituacaoRenovacao, { label: string; cls: string }> = {
  nao_comunicado: { label: 'Não comunicado', cls: 'bg-slate-500/15 text-slate-400' },
  agendado: { label: 'Aguardando envio', cls: 'bg-amber-500/15 text-amber-400' },
  em_acompanhamento: { label: 'Follow-up agendado', cls: 'bg-cyan-500/15 text-cyan-400' },
  enviado: { label: 'Comunicado', cls: 'bg-emerald-500/15 text-emerald-400' },
  respondido: { label: 'Cliente respondeu', cls: 'bg-violet-500/15 text-violet-400' },
  erro: { label: 'Erro no fluxo', cls: 'bg-rose-500/15 text-rose-400' },
  encerrado: { label: 'Encerrado sem envio', cls: 'bg-slate-500/15 text-slate-500' },
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

const ROTULO_ATIVIDADE: Record<string, { label: string; cls: string }> = {
  abordagem: { label: 'Prospecção enviada', cls: 'bg-indigo-500/15 text-indigo-300' },
  follow_up: { label: 'Follow-up realizado', cls: 'bg-sky-500/15 text-sky-300' },
  resposta: { label: 'Resposta recebida', cls: 'bg-emerald-500/15 text-emerald-300' },
  reuniao: { label: 'Reunião registrada', cls: 'bg-violet-500/15 text-violet-300' },
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

function PainelProspeccao({
  dados,
  responsavelSelecionado,
  onResponsavelChange,
}: {
  dados: ResumoDashboard
  responsavelSelecionado: string
  onResponsavelChange: (authId: string) => void
}) {
  const metas = dados.operacao.metasMensais
  const tarefas = dados.tarefas.filter((tarefa) => tarefa.tipo !== 'renovacao')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Dashboard de prospecção</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {dados.visaoProspeccao.modo === 'individual'
              ? `Leads, mensagens e resultados da carteira de ${dados.visaoProspeccao.responsavel?.nome ?? 'comercial'}.`
              : 'Aquisição, contatos, respostas e avanço comercial da equipe nos últimos 30 dias.'}
          </p>
        </div>
        {dados.visaoProspeccao.podeVerEquipe ? (
          <label className="min-w-56">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-600">Visualizar carteira</span>
            <select value={responsavelSelecionado} onChange={(evento) => onResponsavelChange(evento.target.value)}
              className="w-full rounded-lg border border-[#2a3147] bg-[#1a1f2e] px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
              <option value="">Toda a equipe</option>
              {dados.visaoProspeccao.responsaveis.map((item) => <option key={item.authId} value={item.authId}>{item.nome}</option>)}
            </select>
          </label>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300">
            <UserRound size={12} /> Minha carteira
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Novos leads" valor={dados.prospeccao.novos} Icon={Users} cor="text-indigo-400" detalhe="Últimos 30 dias" />
        <Kpi label="Clientes contatados" valor={dados.prospeccao.clientesContatados} Icon={Send} cor="text-cyan-400" detalhe="Últimos 30 dias" />
        <Kpi label="Mensagens enviadas" valor={dados.prospeccao.mensagensEnviadas} Icon={MailCheck} cor="text-sky-400" detalhe="Abordagens e follow-ups" />
        <Kpi label="Respostas recebidas" valor={dados.prospeccao.respostas} Icon={MessageSquare} cor="text-emerald-400" detalhe="Últimos 30 dias" />
        <Kpi label="Reuniões agendadas" valor={dados.prospeccao.reunioes} Icon={CalendarCheck} cor="text-violet-400" detalhe="Últimos 30 dias" />
        <Kpi label="Tarefas comerciais" valor={tarefas.length} Icon={ListTodo} cor="text-amber-400" detalhe="Próximas ações visíveis" />
      </div>

      <section className="overflow-hidden rounded-xl border border-[#2a3147] bg-[#1a1f2e]">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a3147] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><MailCheck size={16} className="text-sky-400" /> Atividade comercial registrada</h2>
            <p className="mt-1 text-xs text-slate-500">Últimas prospecções, follow-ups, respostas e reuniões da carteira selecionada.</p>
          </div>
          <Link href="/automacao?tab=execucoes" className="shrink-0 text-xs text-indigo-400 hover:underline">Ver histórico <ArrowRight className="inline" size={11} /></Link>
        </div>
        {dados.prospeccao.atividades.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma atividade registrada nos últimos 30 dias.</div>
        ) : (
          <div className="divide-y divide-[#2a3147]">
            {dados.prospeccao.atividades.map((atividade) => {
              const visual = ROTULO_ATIVIDADE[atividade.tipo] ?? { label: 'Atividade registrada', cls: 'bg-slate-500/15 text-slate-300' }
              return (
                <Link key={atividade.id} href={`/leads/${atividade.leadId}`} className="grid gap-2 px-5 py-3 transition-colors hover:bg-[#0f1117] md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${visual.cls}`}>{visual.label}</span>
                      <span className="truncate text-sm font-medium text-slate-200">{atividade.empresa}</span>
                    </div>
                    {atividade.descricao && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{atividade.descricao}</p>}
                  </div>
                  <time className="self-center text-xs text-slate-500" dateTime={atividade.realizadaEm}>{formatarDataHora(atividade.realizadaEm)}</time>
                </Link>
              )
            })}
          </div>
        )}
      </section>

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
  const [janela, setJanela] = useState<JanelaRenovacao>('todas')
  const [filtroSituacao, setFiltroSituacao] = useState<FiltroSituacaoRenovacao>('todas')
  const [responsavel, setResponsavel] = useState('todos')
  const [busca, setBusca] = useState('')
  const situacoes = dados.renovacoes.situacoes

  const responsaveis = useMemo(() => {
    const unicos = new Map<string, string>()
    for (const item of dados.vencimentos) {
      if (!item.responsavel) continue
      const chave = item.responsavel.id ?? `nome:${item.responsavel.nome}`
      unicos.set(chave, item.responsavel.nome)
    }
    return [...unicos.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [dados.vencimentos])

  const vencimentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return dados.vencimentos.filter((item) => {
      const naJanela = janela === 'todas'
        || (janela === 'vencidas' && item.diasRestantes < 0)
        || (janela === 'ate_30' && item.diasRestantes >= 0 && item.diasRestantes <= 30)
        || (janela === 'de_31_a_60' && item.diasRestantes >= 31 && item.diasRestantes <= 60)
      if (!naJanela) return false

      const naSituacao = filtroSituacao === 'todas'
        || (filtroSituacao === 'pendentes' && ['nao_comunicado', 'encerrado'].includes(item.situacao))
        || (filtroSituacao === 'agendadas' && item.situacao === 'agendado')
        || (filtroSituacao === 'comunicadas' && ['enviado', 'em_acompanhamento'].includes(item.situacao))
        || (filtroSituacao === 'respondidas' && item.situacao === 'respondido')
        || (filtroSituacao === 'erros' && item.situacao === 'erro')
      if (!naSituacao) return false

      const chaveResponsavel = item.responsavel?.id ?? (item.responsavel ? `nome:${item.responsavel.nome}` : 'sem_responsavel')
      if (responsavel !== 'todos' && chaveResponsavel !== responsavel) return false
      if (!termo) return true
      return [item.empresa, item.responsavel?.nome, item.campanha?.nome, ...item.motivos.map((motivo) => motivo.tipo)]
        .filter(Boolean)
        .some((valor) => valor!.toLocaleLowerCase('pt-BR').includes(termo))
    })
  }, [busca, dados.vencimentos, filtroSituacao, janela, responsavel])

  const resumoOperacional: Array<{
    id: FiltroSituacaoRenovacao
    label: string
    valor: number
    cor: string
  }> = [
    { id: 'pendentes', label: 'Não comunicadas', valor: situacoes.nao_comunicado + situacoes.encerrado, cor: 'text-slate-300' },
    { id: 'agendadas', label: 'Aguardando envio', valor: situacoes.agendado, cor: 'text-amber-400' },
    { id: 'comunicadas', label: 'Em acompanhamento', valor: situacoes.enviado + situacoes.em_acompanhamento, cor: 'text-cyan-400' },
    { id: 'respondidas', label: 'Responderam', valor: situacoes.respondido, cor: 'text-violet-400' },
    { id: 'erros', label: 'Com erro', valor: situacoes.erro, cor: 'text-rose-400' },
  ]

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

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" aria-label="Situação da fila priorizada">
        {resumoOperacional.map((item) => (
          <button key={item.id} type="button" onClick={() => setFiltroSituacao((atual) => atual === item.id ? 'todas' : item.id)}
            aria-pressed={filtroSituacao === item.id}
            className={`rounded-xl border p-3 text-left transition-colors ${filtroSituacao === item.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2a3147] bg-[#1a1f2e] hover:bg-[#202638]'}`}>
            <span className={`block text-xl font-bold tabular-nums ${item.cor}`}>{item.valor.toLocaleString('pt-BR')}</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">{item.label}</span>
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-[#2a3147] bg-[#1a1f2e]">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a3147] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-100"><CalendarClock size={16} className="text-cyan-400" /> Fila de vencimentos e renovações</h2>
            <p className="mt-1 text-xs text-slate-500">Prioridade, comunicação, responsável e próxima ação reunidos por cliente.</p>
          </div>
          <Link href="/base-leads" className="shrink-0 text-xs text-indigo-400 hover:underline">Ver base <ArrowRight className="inline" size={11} /></Link>
        </div>
        {dados.vencimentos.length > 0 && (
          <div className="space-y-3 border-b border-[#2a3147] bg-[#151a27] px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { id: 'todas', label: 'Todas' },
                { id: 'vencidas', label: 'Vencidas' },
                { id: 'ate_30', label: 'Até 30 dias' },
                { id: 'de_31_a_60', label: '31 a 60 dias' },
              ] as const).map((item) => (
                <button key={item.id} type="button" onClick={() => setJanela(item.id)} aria-pressed={janela === item.id}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${janela === item.id ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300' : 'border-[#2a3147] text-slate-500 hover:text-slate-300'}`}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="relative md:col-span-1">
                <span className="sr-only">Buscar cliente, laudo ou campanha</span>
                <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
                <input value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar cliente, laudo ou campanha..."
                  className="w-full rounded-lg border border-[#2a3147] bg-[#0f1117] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-500" />
              </label>
              <select value={filtroSituacao} onChange={(evento) => setFiltroSituacao(evento.target.value as FiltroSituacaoRenovacao)} aria-label="Filtrar situação da renovação"
                className="rounded-lg border border-[#2a3147] bg-[#0f1117] px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <option value="todas">Todas as situações</option>
                <option value="pendentes">Não comunicadas</option>
                <option value="agendadas">Aguardando envio</option>
                <option value="comunicadas">Em acompanhamento</option>
                <option value="respondidas">Cliente respondeu</option>
                <option value="erros">Com erro</option>
              </select>
              <select value={responsavel} onChange={(evento) => setResponsavel(evento.target.value)} aria-label="Filtrar responsável"
                className="rounded-lg border border-[#2a3147] bg-[#0f1117] px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <option value="todos">Todos os responsáveis</option>
                {responsaveis.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                <option value="sem_responsavel">Sem responsável</option>
              </select>
            </div>
          </div>
        )}
        {dados.vencimentos.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <CheckCircle2 className="mx-auto text-emerald-400" size={24} />
            <p className="mt-2 text-sm font-medium text-slate-300">Nenhum vencimento cadastrado</p>
            <p className="mt-1 text-xs text-slate-500">Cadastre a validade no cliente para formar a fila de renovação.</p>
          </div>
        ) : vencimentosFiltrados.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Search className="mx-auto text-slate-600" size={22} />
            <p className="mt-2 text-sm font-medium text-slate-300">Nenhum cliente encontrado</p>
            <p className="mt-1 text-xs text-slate-500">Altere os filtros para consultar outra parte da fila.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-[#2a3147] text-[11px] uppercase tracking-wide text-slate-600">
                  <th className="w-[20%] px-5 py-3 text-left font-medium">Cliente</th>
                  <th className="w-[15%] px-3 py-3 text-left font-medium">Laudo(s)</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Vencimento</th>
                  <th className="w-[20%] px-3 py-3 text-left font-medium">Operação de renovação</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Último contato</th>
                  <th className="w-[12%] px-3 py-3 text-left font-medium">Próxima ação</th>
                  <th className="w-[9%] px-5 py-3 text-right font-medium">Prioridade</th>
                </tr>
              </thead>
              <tbody>
                {vencimentosFiltrados.map((item) => {
                  const visual = statusVisual(item.status)
                  const operacional = ROTULO_SITUACAO[item.situacao]
                  return (
                    <tr key={item.chave} className="border-b border-[#2a3147]/60 transition-colors last:border-0 hover:bg-[#0f1117]">
                      <td className="px-5 py-3" title={item.empresa}>
                        <p className="truncate font-medium text-slate-200">
                          {item.leadId
                            ? <Link href={`/leads/${item.leadId}`} className="hover:text-cyan-300 hover:underline">{item.empresa}</Link>
                            : item.empresa}
                        </p>
                        <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-600">
                          <UserRound size={10} /> {item.responsavel?.nome ?? 'Sem responsável'}
                        </p>
                      </td>
                      <td className="max-w-[220px] px-3 py-3 text-slate-400">
                        <span className="line-clamp-1">{item.motivos.map((motivo) => motivo.tipo).join(', ')}</span>
                        {item.motivos.length > 1 && <span className="text-[11px] text-cyan-500">{item.motivos.length} vencimentos agrupados</span>}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-slate-300">{formatarDataIsoSemFuso(item.vencimentoMaisProximo)}</p>
                        <p className="mt-1 text-[11px] text-slate-600">{prazoHumano(item.diasRestantes)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${operacional.cls}`}>{operacional.label}</span>
                        {item.campanha && (
                          <p className="mt-1 truncate text-[11px] text-slate-500" title={item.campanha.nome}>
                            <Link href={`/automacao/campanhas/${item.campanha.id}`} className="hover:text-cyan-300 hover:underline">{item.campanha.nome}</Link>
                          </p>
                        )}
                        {item.situacao === 'respondido' && item.ultimaRespostaEm
                          ? <p className="mt-1 text-[11px] text-violet-400">Resposta em {formatarDataHora(item.ultimaRespostaEm)}</p>
                          : item.ultimaMensagem
                            ? <p className="mt-1 text-[11px] text-slate-600">Enviado em {formatarDataHora(item.ultimaMensagem.enviadaEm)}</p>
                            : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.ultimoContato ? formatarDataHora(item.ultimoContato) : 'Sem contato'}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{item.proximaAcaoEm ? formatarDataHora(item.proximaAcaoEm) : 'Não agendada'}</td>
                      <td className="px-5 py-3 text-right"><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${visual.cls}`}>{visual.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2a3147] px-5 py-3 text-xs text-slate-500">
          <span>{vencimentosFiltrados.length} de {dados.vencimentos.length} clientes na fila priorizada · {empresas.totalMonitoradas.toLocaleString('pt-BR')} empresas monitoradas</span>
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
  const [responsavelProspeccao, setResponsavelProspeccao] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const requisicaoAtual = useRef(0)

  const carregar = useCallback(async () => {
    const requisicao = ++requisicaoAtual.current
    setCarregando(true)
    setErro(null)
    try {
      const params = new URLSearchParams()
      if (responsavelProspeccao) params.set('responsavel', responsavelProspeccao)
      const url = `/api/dashboard/resumo${params.size ? `?${params.toString()}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.erro || 'Não foi possível carregar o painel.')
      if (requisicao === requisicaoAtual.current) setDados(payload as ResumoDashboard)
    } catch (e) {
      if (requisicao === requisicaoAtual.current) setErro(e instanceof Error ? e.message : 'Erro ao carregar o painel')
    } finally {
      if (requisicao === requisicaoAtual.current) setCarregando(false)
    }
  }, [responsavelProspeccao])

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
        : <PainelProspeccao dados={dados} responsavelSelecionado={responsavelProspeccao} onResponsavelChange={setResponsavelProspeccao} />}
    </div>
  )
}
