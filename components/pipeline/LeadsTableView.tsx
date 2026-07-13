'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react'
import { labelEstagio, labelProximaAcao, labelCanal, corEstagio, COLUNAS, type ColunaId } from '@/lib/pipeline-stages'
import { getTodosLeads, type LeadOrdenavel } from '@/lib/api'
import { dash } from '@/lib/utils'
import type { Lead } from '@/lib/supabase'
import { diasDesde, rotuloDias } from './prioridade'
import type { GlobalFilterState } from './GlobalFilters'
import { EstadoTabela, PaginacaoTabela } from '@/components/ui/tabela'

const PAGE = 50

// Chips de status — usam os mesmos grupos/cores do Kanban (COLUNAS), sem
// alterar as regras de negócio. "Todos" não filtra por estágio.
const CHIPS: { id: ColunaId | 'todos'; label: string; color?: string }[] = [
  { id: 'todos', label: 'Todos' },
  ...COLUNAS.map(c => ({ id: c.id, label: c.label, color: c.color })),
]

interface ColunaTabela {
  key: string
  label: string
  ordenarPor?: LeadOrdenavel
  className?: string
}

const COLUNAS_TABELA: ColunaTabela[] = [
  { key: 'empresa', label: 'Empresa', ordenarPor: 'empresa' },
  { key: 'decisor', label: 'Decisor' },
  { key: 'cargo', label: 'Cargo', ordenarPor: 'contato_cargo' },
  { key: 'segmento', label: 'Segmento', ordenarPor: 'segmento' },
  { key: 'canal', label: 'Canal', ordenarPor: 'canal_preferencial' },
  { key: 'status', label: 'Status', ordenarPor: 'estagio' },
  { key: 'ultima_interacao', label: 'Última interação', ordenarPor: 'ultimo_contato' },
  { key: 'proxima_acao', label: 'Próxima ação' },
  { key: 'responsavel', label: 'Responsável', ordenarPor: 'responsavel_nome' },
]

// Tabela operacional: visão PRINCIPAL de leads em alto volume (milhares de
// contatos). Busca + filtros rápidos + ordenação + paginação — sem carregar
// tudo de uma vez (server-side, igual à Base de Leads).
export default function LeadsTableView({
  filtros,
  selectedId,
  onSelect,
  reloadKey,
}: {
  filtros: GlobalFilterState
  selectedId: string | null
  onSelect: (id: string) => void
  reloadKey: number
}) {
  const [chip, setChip] = useState<ColunaId | 'todos'>('todos')
  const [sort, setSort] = useState<{ campo: LeadOrdenavel; asc: boolean }>({ campo: 'ultimo_contato', asc: false })
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // Nº de sequência do fetch: uma resposta antiga (lenta) em voo não pode
  // sobrescrever a de um fetch mais novo.
  const seqRef = useRef(0)

  const estagios = useMemo(
    () => (chip === 'todos' ? undefined : COLUNAS.find(c => c.id === chip)?.estagios),
    [chip],
  )

  // Só a BUSCA digitada precisa de debounce; cliques (página, chip, ordenação,
  // selects dos filtros globais) disparam o fetch imediatamente.
  const [buscaDebounced, setBuscaDebounced] = useState(filtros.search)
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(filtros.search), 250)
    return () => clearTimeout(t)
  }, [filtros.search])

  // Troca de filtro/chip/ordenação volta pra primeira página.
  useEffect(() => { setPage(0) }, [filtros, chip, sort])

  const carregar = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    const { data, total } = await getTodosLeads(
      {
        busca: buscaDebounced || undefined,
        responsavel: filtros.responsavel || undefined,
        segmento: filtros.segmento || undefined,
        canal: filtros.canal || undefined,
        estagios,
        ordenarPor: sort,
      },
      { limit: PAGE, offset: page * PAGE },
    )
    if (seq !== seqRef.current) return // resposta antiga — um fetch mais novo já partiu
    setData(data)
    setTotal(total)
    setLoading(false)
    // Mutação (reloadKey) pode encolher o total com a página atual além do fim
    // (offset fora do range → página "vazia" com leads existindo): volta para a
    // última página válida, o que dispara novo fetch.
    const ultimaPagina = Math.max(0, Math.ceil(total / PAGE) - 1)
    if (page > ultimaPagina) setPage(ultimaPagina)
  }, [buscaDebounced, filtros.responsavel, filtros.segmento, filtros.canal, estagios, sort, page])

  useEffect(() => { carregar() }, [carregar, reloadKey])

  const toggleSort = (campo?: LeadOrdenavel) => {
    if (!campo) return
    setSort(prev => (prev.campo === campo ? { campo, asc: !prev.asc } : { campo, asc: true }))
  }

  return (
    <div className="h-full flex flex-col min-h-0 px-6 pb-4">
      {/* Filtros rápidos de estágio */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3 shrink-0">
        {CHIPS.map(c => {
          const ativo = chip === c.id
          return (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                ativo
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  : 'text-slate-400 border-[#2a3147] hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {c.color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Tabela */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[#2a3147]/60">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-[#0f1117]">
              {COLUNAS_TABELA.map(col => (
                <th key={col.key} className="font-semibold px-3 py-2.5 border-b border-[#2a3147] whitespace-nowrap">
                  {col.ordenarPor ? (
                    <button
                      onClick={() => toggleSort(col.ordenarPor)}
                      className="flex items-center gap-1 hover:text-slate-300 transition-colors"
                    >
                      {col.label}
                      {sort.campo === col.ordenarPor ? (
                        sort.asc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      ) : (
                        <ArrowUpDown size={11} className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <EstadoTabela colSpan={COLUNAS_TABELA.length} loading={loading} />
            ) : (
              data.map(lead => {
                const responsavel = lead.usuarios?.nome ?? lead.responsavel_nome ?? null
                const ultima = rotuloDias(diasDesde(lead.ultimo_contato))
                return (
                  <tr
                    key={lead.id}
                    onClick={() => onSelect(lead.id)}
                    className={`cursor-pointer transition-colors ${selectedId === lead.id ? 'bg-indigo-500/10' : 'hover:bg-[#1a1f2e]'}`}
                  >
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 font-medium text-slate-100 max-w-56 truncate">{dash(lead.empresa)}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 max-w-48">
                      <div className="text-slate-300 truncate">{dash(lead.contato_nome)}</div>
                      {lead.contato_email && <div className="text-xs text-slate-500 truncate">{lead.contato_email}</div>}
                    </td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap max-w-40 truncate">{dash(lead.contato_cargo)}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{dash(lead.segmento)}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{labelCanal(lead.canal_preferencial)}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 whitespace-nowrap">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${corEstagio(lead.estagio)}26`, color: corEstagio(lead.estagio) }}
                      >
                        {labelEstagio(lead.estagio)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-400 whitespace-nowrap">{ultima ?? '—'}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap max-w-40 truncate">{labelProximaAcao(lead.proxima_acao)}</td>
                    <td className="px-3 py-2.5 border-b border-[#2a3147]/60 text-slate-300 whitespace-nowrap">{dash(responsavel)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <PaginacaoTabela
        total={total}
        page={page}
        pageSize={PAGE}
        loading={loading}
        onPageChange={setPage}
        className="pt-3 shrink-0"
      />
    </div>
  )
}
