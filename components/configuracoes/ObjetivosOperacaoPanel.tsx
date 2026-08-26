'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  Check,
  CircleDollarSign,
  FileBarChart,
  Lock,
  Save,
  Send,
} from 'lucide-react'
import {
  operacaoEfetiva,
  renovacaoEfetiva,
  type ObjetivoOperacional,
} from '@/lib/config/workspaceConfig'

interface EstadoObjetivos {
  ativos: ObjetivoOperacional[]
  principal: ObjetivoOperacional
  relatorioSemanal: boolean
  contatos: string
  reunioes: string
  renovacoes: string
  antecedenciaDias: string
}

const INICIAL: EstadoObjetivos = {
  ativos: ['prospeccao', 'vencimentos_laudos'],
  principal: 'prospeccao',
  relatorioSemanal: true,
  contatos: '',
  reunioes: '',
  renovacoes: '',
  antecedenciaDias: '45',
}

function inteiroPositivo(valor: string): number | undefined {
  const numero = Number(valor)
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero) : undefined
}

export default function ObjetivosOperacaoPanel() {
  const [estado, setEstado] = useState<EstadoObjetivos>(INICIAL)
  const [podeEditar, setPodeEditar] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar os objetivos.')
        return res.json()
      })
      .then(({ config, podeEditar: permitido }) => {
        const operacao = operacaoEfetiva(config)
        const renovacao = renovacaoEfetiva(config)
        setPodeEditar(!!permitido)
        setEstado({
          ativos: operacao.objetivosAtivos,
          principal: operacao.objetivoPrincipal,
          relatorioSemanal: operacao.relatorioSemanal,
          contatos: operacao.metasMensais.contatos?.toString() ?? '',
          reunioes: operacao.metasMensais.reunioes?.toString() ?? '',
          renovacoes: operacao.metasMensais.renovacoes?.toString() ?? '',
          antecedenciaDias: renovacao.antecedenciaDias.toString(),
        })
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false))
  }, [])

  function alternarObjetivo(objetivo: ObjetivoOperacional) {
    if (!podeEditar) return
    setEstado((atual) => {
      const ativo = atual.ativos.includes(objetivo)
      if (ativo && atual.ativos.length === 1) return atual
      const ativos = ativo
        ? atual.ativos.filter((item) => item !== objetivo)
        : [...atual.ativos, objetivo]
      return {
        ...atual,
        ativos,
        principal: ativos.includes(atual.principal) ? atual.principal : ativos[0],
      }
    })
  }

  async function salvar() {
    if (!podeEditar || salvando) return
    setSalvando(true)
    setSalvo(false)
    setErro(null)
    try {
      const res = await fetch('/api/configuracoes/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operacao: {
            objetivoPrincipal: estado.principal,
            objetivosAtivos: estado.ativos,
            relatorioSemanal: estado.relatorioSemanal,
            metasMensais: {
              contatos: inteiroPositivo(estado.contatos),
              reunioes: inteiroPositivo(estado.reunioes),
              renovacoes: inteiroPositivo(estado.renovacoes),
            },
          },
          renovacaoAntecedenciaDias: Math.max(0, Number(estado.antecedenciaDias) || 0),
        }),
      })
      if (!res.ok) throw new Error((await res.json())?.erro || 'Falha ao salvar objetivos')
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2500)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const input = 'w-full rounded-lg border border-[#2a3147] bg-[#0f1117] px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-50'

  if (carregando) {
    return <div className="h-56 animate-pulse rounded-xl border border-[#2a3147] bg-[#1a1f2e]" />
  }

  return (
    <div className="space-y-5">
      {!podeEditar && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-400">
          <Lock size={13} /> Somente leitura — requer a permissão <code>workspace.configure</code>.
        </div>
      )}

      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 shrink-0 text-indigo-400" size={18} />
          <div>
            <h2 className="font-semibold text-slate-100">O cliente continua no centro da operação</h2>
            <p className="mt-1 text-sm text-slate-400">
              Estes objetivos escolhem quais prazos, indicadores, públicos de campanha e seções do relatório serão priorizados.
            </p>
          </div>
        </div>
      </div>

      <section>
        <div className="mb-3">
          <h2 className="font-semibold text-slate-100">Objetivos ativos</h2>
          <p className="text-sm text-slate-500">Você pode combinar objetivos e escolher qual aparece primeiro.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {([
            {
              id: 'prospeccao' as const,
              titulo: 'Prospecção',
              descricao: 'Contatos, respostas, reuniões e oportunidades.',
              Icon: Send,
              cor: 'text-indigo-400',
            },
            {
              id: 'vencimentos_laudos' as const,
              titulo: 'Vencimento de laudos',
              descricao: 'Clientes com laudos vencidos ou próximos da renovação.',
              Icon: CalendarClock,
              cor: 'text-amber-400',
            },
          ]).map(({ id, titulo, descricao, Icon, cor }) => {
            const ativo = estado.ativos.includes(id)
            const principal = estado.principal === id
            return (
              <div key={id} className={`rounded-xl border p-4 transition-colors ${ativo ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-[#2a3147] bg-[#1a1f2e]'}`}>
                <button type="button" disabled={!podeEditar} onClick={() => alternarObjetivo(id)} className="w-full text-left disabled:cursor-default">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`rounded-lg bg-[#0f1117] p-2 ${cor}`}><Icon size={18} /></span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${ativo ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-600'}`}>
                      {ativo && <Check size={12} />}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold text-slate-100">{titulo}</h3>
                  <p className="mt-1 text-sm text-slate-500">{descricao}</p>
                </button>
                {ativo && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-[#2a3147] pt-3 text-xs text-slate-400">
                    <input type="radio" name="objetivo-principal" checked={principal} disabled={!podeEditar}
                      onChange={() => setEstado((atual) => ({ ...atual, principal: id }))} />
                    Objetivo principal
                  </label>
                )}
              </div>
            )
          })}

          <div className="rounded-xl border border-dashed border-[#2a3147] bg-[#1a1f2e]/60 p-4 opacity-70">
            <span className="inline-flex rounded-lg bg-[#0f1117] p-2 text-emerald-400"><CircleDollarSign size={18} /></span>
            <h3 className="mt-3 font-semibold text-slate-300">Cobranças e pagamentos</h3>
            <p className="mt-1 text-sm text-slate-500">Será habilitado quando houver contas a receber e baixa de pagamento reais.</p>
            <span className="mt-3 inline-block text-xs font-medium text-slate-500">Ainda não disponível</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
          <h2 className="font-semibold text-slate-100">Parâmetros operacionais</h2>
          <p className="mt-1 text-sm text-slate-500">Definem quando o cliente entra na fila de ação.</p>
          <label className="mt-4 block text-sm text-slate-300">
            Antecedência para vencimentos de laudos
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min="0" max="365" disabled={!podeEditar} className={input}
                value={estado.antecedenciaDias} onChange={(e) => setEstado((s) => ({ ...s, antecedenciaDias: e.target.value }))} />
              <span className="text-sm text-slate-500">dias</span>
            </div>
          </label>
        </section>

        <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-slate-100"><FileBarChart size={16} className="text-cyan-400" /> Relatório semanal</h2>
              <p className="mt-1 text-sm text-slate-500">O relatório passa a trazer uma seção para cada objetivo ativo.</p>
            </div>
            <input type="checkbox" checked={estado.relatorioSemanal} disabled={!podeEditar}
              onChange={(e) => setEstado((s) => ({ ...s, relatorioSemanal: e.target.checked }))} />
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[#2a3147] bg-[#1a1f2e] p-5">
        <h2 className="font-semibold text-slate-100">Metas mensais</h2>
        <p className="mt-1 text-sm text-slate-500">Campos vazios não geram progresso artificial no painel.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="text-sm text-slate-300">Empresas contatadas
            <input type="number" min="1" disabled={!podeEditar || !estado.ativos.includes('prospeccao')} className={`${input} mt-1`}
              value={estado.contatos} onChange={(e) => setEstado((s) => ({ ...s, contatos: e.target.value }))} placeholder="Sem meta" />
          </label>
          <label className="text-sm text-slate-300">Reuniões agendadas
            <input type="number" min="1" disabled={!podeEditar || !estado.ativos.includes('prospeccao')} className={`${input} mt-1`}
              value={estado.reunioes} onChange={(e) => setEstado((s) => ({ ...s, reunioes: e.target.value }))} placeholder="Sem meta" />
          </label>
          <label className="text-sm text-slate-300">Laudos renovados
            <input type="number" min="1" disabled={!podeEditar || !estado.ativos.includes('vencimentos_laudos')} className={`${input} mt-1`}
              value={estado.renovacoes} onChange={(e) => setEstado((s) => ({ ...s, renovacoes: e.target.value }))} placeholder="Sem meta" />
          </label>
        </div>
      </section>

      {erro && <p className="text-sm text-red-400">{erro}</p>}
      {podeEditar && (
        <div className="flex justify-end">
          <button type="button" onClick={salvar} disabled={salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            {salvo ? <><Check size={15} /> Objetivos salvos</> : <><Save size={15} /> Salvar objetivos</>}
          </button>
        </div>
      )}
    </div>
  )
}
