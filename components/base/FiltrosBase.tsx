'use client'

import { useState } from 'react'
import {
  CalendarDays, ChevronDown, MapPin, RotateCcw, Search, SlidersHorizontal, Users, X, type LucideIcon,
} from 'lucide-react'
import { STATUS_COMERCIAL_OPCOES } from '@/lib/pipeline-stages'
import { UFS_BRASIL } from '@/lib/config/workspaceConfig'
import { NOME_UF } from '@/lib/prospeccao/estados'
import s from './FiltrosBase.module.css'

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

const ATALHOS: { id: BaseFiltroForm['atalho']; label: string; cor: string | null }[] = [
  { id: '', label: 'Todos', cor: null },
  { id: 'responderam', label: 'Responderam', cor: '#22c55e' },
  { id: 'sem_resposta', label: 'Sem resposta', cor: '#f59e0b' },
  { id: 'arquivados', label: 'Arquivados', cor: '#94a3b8' },
  { id: 'reativacao', label: 'Em reativação', cor: '#38bdf8' },
]

const FOLLOWUPS: { value: BaseFiltroForm['followup']; label: string }[] = [
  { value: '1', label: '1º follow-up' },
  { value: '2', label: '2º follow-up' },
  { value: '3', label: '3º follow-up' },
  { value: '4+', label: '4º ou mais' },
]

const UFS_POR_NOME = [...UFS_BRASIL].sort((a, b) => NOME_UF[a].localeCompare(NOME_UF[b], 'pt-BR'))

// Filtros do painel "Filtros" (fora a busca e o atalho, que ficam sempre à vista).
type CampoAvancado = Exclude<keyof BaseFiltroForm, 'busca' | 'atalho'>
const AVANCADOS: CampoAvancado[] = [
  'responsavel', 'segmento', 'estagio', 'followup', 'cidade', 'estado',
  'cadastroDe', 'cadastroAte', 'interacaoDe', 'interacaoAte',
]

const dataBr = (iso: string) => iso.split('-').reverse().join('/')

function periodo(de: string, ate: string): string {
  if (de && ate) return `${dataBr(de)} a ${dataBr(ate)}`
  return de ? `desde ${dataBr(de)}` : `até ${dataBr(ate)}`
}

/** Etiquetas dos filtros avançados ativos; cada uma sabe o que limpar. */
function etiquetasAtivas(v: BaseFiltroForm): { chave: string; texto: string; limpa: Partial<BaseFiltroForm> }[] {
  const lista: { chave: string; texto: string; limpa: Partial<BaseFiltroForm> }[] = []
  if (v.responsavel) lista.push({ chave: 'responsavel', texto: `Responsável: ${v.responsavel}`, limpa: { responsavel: '' } })
  if (v.segmento) lista.push({ chave: 'segmento', texto: `Segmento: ${v.segmento}`, limpa: { segmento: '' } })
  if (v.estagio) {
    const rotulo = STATUS_COMERCIAL_OPCOES.find((o) => o.value === v.estagio)?.label ?? v.estagio
    lista.push({ chave: 'estagio', texto: `Status: ${rotulo}`, limpa: { estagio: '' } })
  }
  if (v.followup) {
    const rotulo = FOLLOWUPS.find((f) => f.value === v.followup)?.label ?? v.followup
    lista.push({ chave: 'followup', texto: `Follow-up: ${rotulo}`, limpa: { followup: '' } })
  }
  if (v.cidade) lista.push({ chave: 'cidade', texto: `Cidade: ${v.cidade}`, limpa: { cidade: '' } })
  if (v.estado) lista.push({ chave: 'estado', texto: `Estado: ${v.estado.toUpperCase()}`, limpa: { estado: '' } })
  if (v.cadastroDe || v.cadastroAte) {
    lista.push({ chave: 'cadastro', texto: `Cadastro: ${periodo(v.cadastroDe, v.cadastroAte)}`, limpa: { cadastroDe: '', cadastroAte: '' } })
  }
  if (v.interacaoDe || v.interacaoAte) {
    lista.push({ chave: 'interacao', texto: `Interação: ${periodo(v.interacaoDe, v.interacaoAte)}`, limpa: { interacaoDe: '', interacaoAte: '' } })
  }
  return lista
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className={s.rotulo}>
      <span>{rotulo}</span>
      {children}
    </label>
  )
}

function Grupo({ icone: Icone, titulo, className = '', children }: {
  icone: LucideIcon
  titulo: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <fieldset className={`${s.grupo} ${className}`}>
      <legend><Icone size={13} aria-hidden="true" /> {titulo}</legend>
      {children}
    </fieldset>
  )
}

// <select> nativo com a aparência dos demais campos; borda realçada quando filtra.
function Selecao({ valor, onChange, rotulo, children }: {
  valor: string
  onChange: (v: string) => void
  rotulo: string
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-label={rotulo}
        className={`${s.campo} ${valor ? s.campoAtivo : ''} ${s.comAcao} appearance-none cursor-pointer focus-ring`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  )
}

// Filtros da Base de Leads (todos aplicam server-side no pai). Busca e atalhos
// ficam sempre à vista; o resto abre no painel "Filtros", agrupado por assunto.
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
  const avancadosAtivos = AVANCADOS.filter((c) => value[c] !== '').length
  const algumAtivo = Object.values(value).some((v) => v !== '')
  const [aberto, setAberto] = useState(avancadosAtivos > 0)
  const etiquetas = aberto ? [] : etiquetasAtivas(value)

  const data = (campo: 'cadastroDe' | 'cadastroAte' | 'interacaoDe' | 'interacaoAte', rotulo: string) => (
    <input
      type="date"
      value={value[campo]}
      onChange={(e) => set({ [campo]: e.target.value })}
      aria-label={rotulo}
      className={`${s.campo} ${value[campo] ? s.campoAtivo : ''} focus-ring`}
    />
  )

  return (
    <div>
      {/* Barra principal: busca, atalhos e o botão dos filtros */}
      <div className={s.barra}>
        <div className={`${s.busca} relative`}>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-300" />
          <input
            value={value.busca}
            onChange={(e) => set({ busca: e.target.value })}
            placeholder="Buscar empresa, contato ou e-mail"
            aria-label="Buscar"
            className={`${s.campo} ${value.busca ? s.campoAtivo : ''} ${s.comIcone} ${s.comAcao} focus-ring`}
          />
          {value.busca && (
            <button
              type="button"
              onClick={() => set({ busca: '' })}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className={s.segmentado} role="group" aria-label="Atalhos">
          {ATALHOS.map((a) => {
            const ativo = value.atalho === a.id
            return (
              <button
                key={a.id || 'todos'}
                type="button"
                aria-pressed={ativo}
                onClick={() => set({ atalho: a.id })}
                className={`${ativo ? s.segmentoAtivo : ''} focus-ring`}
              >
                {a.cor && <b style={{ background: a.cor }} aria-hidden="true" />}
                {a.label}
              </button>
            )
          })}
        </div>

        <div className={s.acoesBarra}>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-controls="filtros-base-avancados"
            className={`${s.botaoFiltros} ${aberto ? s.botaoFiltrosAberto : ''} focus-ring`}
          >
            <SlidersHorizontal size={14} /> Filtros
            {avancadosAtivos > 0 && <em>{avancadosAtivos}</em>}
            <ChevronDown size={14} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} />
          </button>
          {algumAtivo && (
            <button type="button" onClick={() => onChange(FILTRO_VAZIO)} className={`${s.limpar} focus-ring`}>
              <RotateCcw size={13} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Filtros ativos, quando o painel está fechado */}
      {etiquetas.length > 0 && (
        <div className={s.etiquetas}>
          {etiquetas.map((e) => (
            <span key={e.chave} className={s.etiqueta}>
              {e.texto}
              <button type="button" onClick={() => set(e.limpa)} aria-label={`Remover filtro ${e.texto}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Painel de filtros agrupados */}
      {aberto && (
        <div id="filtros-base-avancados" className={s.painelAvancado}>
          <Grupo icone={Users} titulo="Funil" className={s.grupoFunil}>
            <Campo rotulo="Responsável">
              <Selecao rotulo="Responsável" valor={value.responsavel} onChange={(v) => set({ responsavel: v })}>
                <option value="">Todos</option>
                {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
              </Selecao>
            </Campo>
            <Campo rotulo="Segmento">
              <Selecao rotulo="Segmento" valor={value.segmento} onChange={(v) => set({ segmento: v })}>
                <option value="">Todos</option>
                {segmentos.map((seg) => <option key={seg} value={seg}>{seg}</option>)}
              </Selecao>
            </Campo>
            <Campo rotulo="Status">
              <Selecao rotulo="Status" valor={value.estagio} onChange={(v) => set({ estagio: v })}>
                <option value="">Todos</option>
                {STATUS_COMERCIAL_OPCOES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
              </Selecao>
            </Campo>
            <Campo rotulo="Follow-up">
              <Selecao rotulo="Follow-up" valor={value.followup} onChange={(v) => set({ followup: v as BaseFiltroForm['followup'] })}>
                <option value="">Qualquer etapa</option>
                {FOLLOWUPS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Selecao>
            </Campo>
          </Grupo>

          <Grupo icone={MapPin} titulo="Localização">
            <Campo rotulo="Cidade">
              <input
                value={value.cidade}
                onChange={(e) => set({ cidade: e.target.value })}
                placeholder="Qualquer cidade"
                className={`${s.campo} ${value.cidade ? s.campoAtivo : ''} focus-ring`}
              />
            </Campo>
            <Campo rotulo="Estado">
              <Selecao rotulo="Estado" valor={value.estado} onChange={(v) => set({ estado: v })}>
                <option value="">Todos</option>
                {UFS_POR_NOME.map((uf) => <option key={uf} value={uf}>{NOME_UF[uf]} ({uf})</option>)}
              </Selecao>
            </Campo>
          </Grupo>

          <Grupo icone={CalendarDays} titulo="Período">
            <Campo rotulo="Cadastrado entre">
              <div className={s.periodo}>
                {data('cadastroDe', 'Cadastrado a partir de')}
                <i>até</i>
                {data('cadastroAte', 'Cadastrado até')}
              </div>
            </Campo>
            <Campo rotulo="Última interação entre">
              <div className={s.periodo}>
                {data('interacaoDe', 'Última interação a partir de')}
                <i>até</i>
                {data('interacaoAte', 'Última interação até')}
              </div>
            </Campo>
          </Grupo>
        </div>
      )}
    </div>
  )
}
