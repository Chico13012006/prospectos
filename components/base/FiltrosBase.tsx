'use client'

import { Search, X } from 'lucide-react'
import { STATUS_COMERCIAL_OPCOES } from '@/lib/pipeline-stages'

export interface BaseFiltroForm {
  busca: string
  responsavel: string
  segmento: string
  estagio: string
  followup: '' | '1' | '2' | '3' | '4+'
  cidade: string
  estado: string
  cadastroDe: string
  cadastroAte: string
  interacaoDe: string
  interacaoAte: string
  atalho: '' | 'responderam' | 'sem_resposta' | 'arquivados' | 'reativacao'
}

export const FILTRO_VAZIO: BaseFiltroForm = {
  busca: '', responsavel: '', segmento: '', estagio: '', followup: '',
  cidade: '', estado: '', cadastroDe: '', cadastroAte: '', interacaoDe: '', interacaoAte: '', atalho: '',
}

const CHIPS: { id: BaseFiltroForm['atalho']; label: string }[] = [
  { id: 'responderam', label: 'Responderam' },
  { id: 'sem_resposta', label: 'Sem resposta' },
  { id: 'arquivados', label: 'Arquivados/descartados' },
  { id: 'reativacao', label: 'Em reativação' },
]

// Filtros avançados da Base de Leads (todos aplicam server-side no pai).
export default function FiltrosBase({
  value,
  onChange,
  responsaveis,
  segmentos,
}: {
  value: BaseFiltroForm
  onChange: (v: BaseFiltroForm) => void
  responsaveis: string[]
  segmentos: string[]
}) {
  const set = (patch: Partial<BaseFiltroForm>) => onChange({ ...value, ...patch })
  const temFiltro = Object.entries(value).some(([, v]) => v !== '')

  const inputCls = 'text-sm border border-[#2a3147] rounded-lg px-2.5 py-2 bg-[#1a1f2e] text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40'
  const selectCls = inputCls

  return (
    <div className="space-y-2">
      {/* Linha 1: busca + selects principais */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={value.busca}
            onChange={(e) => set({ busca: e.target.value })}
            placeholder="Buscar empresa, contato ou e-mail..."
            className={`${inputCls} pl-8 w-72`}
          />
        </div>
        <select value={value.responsavel} onChange={(e) => set({ responsavel: e.target.value })} className={selectCls}>
          <option value="">Todos os responsáveis</option>
          {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={value.segmento} onChange={(e) => set({ segmento: e.target.value })} className={selectCls}>
          <option value="">Todos os nichos</option>
          {segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={value.estagio} onChange={(e) => set({ estagio: e.target.value })} className={selectCls}>
          <option value="">Todos os status</option>
          {STATUS_COMERCIAL_OPCOES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={value.followup} onChange={(e) => set({ followup: e.target.value as BaseFiltroForm['followup'] })} className={selectCls}>
          <option value="">Qualquer follow-up</option>
          <option value="1">1º Follow-up</option>
          <option value="2">2º Follow-up</option>
          <option value="3">3º Follow-up</option>
          <option value="4+">4º+ Follow-up</option>
        </select>
        {temFiltro && (
          <button
            onClick={() => onChange(FILTRO_VAZIO)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-2"
          >
            <X size={13} /> Limpar
          </button>
        )}
      </div>

      {/* Linha 2: cidade/UF + datas */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={value.cidade} onChange={(e) => set({ cidade: e.target.value })} placeholder="Cidade" className={`${inputCls} w-36`} />
        <input value={value.estado} onChange={(e) => set({ estado: e.target.value })} placeholder="UF" maxLength={2} className={`${inputCls} w-20 uppercase`} />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Cadastro
          <input type="date" value={value.cadastroDe} onChange={(e) => set({ cadastroDe: e.target.value })} className={inputCls} />
          <span>–</span>
          <input type="date" value={value.cadastroAte} onChange={(e) => set({ cadastroAte: e.target.value })} className={inputCls} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Última interação
          <input type="date" value={value.interacaoDe} onChange={(e) => set({ interacaoDe: e.target.value })} className={inputCls} />
          <span>–</span>
          <input type="date" value={value.interacaoAte} onChange={(e) => set({ interacaoAte: e.target.value })} className={inputCls} />
        </label>
      </div>

      {/* Linha 3: chips de atalho */}
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map((c) => {
          const ativo = value.atalho === c.id
          return (
            <button
              key={c.id}
              onClick={() => set({ atalho: ativo ? '' : c.id })}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                ativo
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  : 'text-slate-400 border-[#2a3147] hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
