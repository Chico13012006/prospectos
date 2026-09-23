'use client'

import { useState } from 'react'
import { Building2, Calendar, Landmark, Loader2, Mail, MapPin, Phone, Tag, UserRound, Users } from 'lucide-react'
import type { ResultadoCatalogo } from '@/lib/prospeccao/buscaServidor'
import type { Socio } from '@/lib/prospeccao/socios'
import { formatarCnae, nomeLegivel, rotuloPorte } from '@/lib/prospeccao/rotulos'
import { ROTULO_QUALIDADE } from '@/lib/prospeccao/qualidadeEmail'

export interface Decisor {
  nome: string
  cargo: string
}

function anosDesde(iso: string): number {
  const inicio = new Date(`${iso}T00:00:00Z`)
  const hoje = new Date()
  let anos = hoje.getUTCFullYear() - inicio.getUTCFullYear()
  if (hoje.getUTCMonth() < inicio.getUTCMonth() || (hoje.getUTCMonth() === inicio.getUTCMonth() && hoje.getUTCDate() < inicio.getUTCDate())) anos--
  return Math.max(0, anos)
}

function Dado({ icone: Icone, rotulo, children }: { icone: typeof Mail; rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 min-w-0">
      <Icone size={14} className="mt-0.5 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{rotulo}</dt>
        <dd className="text-sm text-slate-200 break-words">{children || <span className="text-slate-500">—</span>}</dd>
      </div>
    </div>
  )
}

// Passo "analisar": dados do catálogo + quadro societário sob demanda
// (OpenCNPJ). O sócio escolhido vira o contato do lead na importação.
export default function DetalheEmpresa({
  empresa,
  decisor,
  onDecisor,
}: {
  empresa: ResultadoCatalogo
  decisor: Decisor | null
  onDecisor: (d: Decisor | null) => void
}) {
  const [socios, setSocios] = useState<Socio[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregarSocios() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/prospeccao/socios?cnpj=${empresa.cnpj}`)
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(corpo?.erro || 'Não foi possível consultar os sócios.')
      setSocios(corpo.socios ?? [])
      if (!decisor && corpo.sugerido) onDecisor({ nome: corpo.sugerido.nome, cargo: corpo.sugerido.qualificacao })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao consultar sócios')
    } finally {
      setCarregando(false)
    }
  }

  const endereco = [
    nomeLegivel([empresa.logradouro, empresa.numero].filter(Boolean).join(', ')),
    nomeLegivel(empresa.bairro),
    [nomeLegivel(empresa.municipio), empresa.uf].filter(Boolean).join('/'),
  ].filter(Boolean).join(' · ')
  const cep = empresa.cep ? `CEP ${empresa.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : null
  const abertura = empresa.data_inicio_atividade
  const secundarios = empresa.cnaes_secundarios

  return (
    <div className="grid gap-4 bg-[var(--bg-subtle)] px-5 py-5 lg:grid-cols-[3fr_2fr]" onClick={(e) => e.stopPropagation()}>
      {/* Dados da Receita */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Building2 size={15} className="text-indigo-300" /> Dados da Receita Federal
        </h4>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Dado icone={Landmark} rotulo="Razão social">{nomeLegivel(empresa.razao_social)}</Dado>
          <Dado icone={Tag} rotulo="Atividade principal">{formatarCnae(empresa.cnae_principal)}</Dado>
          <Dado icone={Calendar} rotulo="Abertura">
            {abertura && (
              <>
                {new Date(`${abertura}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
                <span className="text-slate-500"> · {anosDesde(abertura)} anos</span>
              </>
            )}
          </Dado>
          <Dado icone={Building2} rotulo="Porte e capital">
            {rotuloPorte(empresa.porte)}
            {empresa.mei ? ' (MEI)' : ''}
            {empresa.capital_social !== null && (
              <span className="text-slate-500"> · {empresa.capital_social.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</span>
            )}
          </Dado>
          <div className="sm:col-span-2">
            <Dado icone={MapPin} rotulo="Endereço">
              {endereco}
              {cep && <span className="text-slate-500"> · {cep}</span>}
            </Dado>
          </div>
          <Dado icone={Mail} rotulo="E-mail cadastral">
            {empresa.email && (
              <>
                {empresa.email}
                <span className="text-slate-500"> · {ROTULO_QUALIDADE[empresa.qualidade_email]}</span>
              </>
            )}
          </Dado>
          <Dado icone={Phone} rotulo="Telefone cadastral">{empresa.telefone}</Dado>
        </dl>
        {secundarios.length > 0 && (
          <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">Atividades secundárias</p>
            <div className="flex flex-wrap gap-1">
              {secundarios.slice(0, 10).map((c) => (
                <span key={c} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-400">{formatarCnae(c)}</span>
              ))}
              {secundarios.length > 10 && <span className="px-1 text-[11px] text-slate-500">+{secundarios.length - 10}</span>}
            </div>
          </div>
        )}
      </section>

      {/* Decisor */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Users size={15} className="text-indigo-300" /> Decisor
          </h4>
          {socios === null && (
            <button
              onClick={carregarSocios}
              disabled={carregando}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-medium text-indigo-200 ring-1 ring-inset ring-indigo-500/40 hover:bg-indigo-500/20 disabled:opacity-50 focus-ring"
            >
              {carregando ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />} Ver sócios
            </button>
          )}
        </div>

        {socios === null && !erro && (
          <p className="text-xs text-slate-500">Consulte o quadro societário (OpenCNPJ) para escolher quem vai receber o contato.</p>
        )}
        {erro && <p className="text-xs text-red-400">{erro}</p>}
        {socios !== null && socios.length === 0 && (
          <p className="text-xs text-slate-500">Nenhum sócio pessoa física no quadro. Informe o contato manualmente.</p>
        )}
        {socios !== null && socios.length > 0 && (
          <ul className="space-y-1.5">
            {socios.map((s) => {
              const ativo = decisor?.nome === s.nome
              return (
                <li key={`${s.nome}-${s.qualificacao}`}>
                  <button
                    onClick={() => onDecisor({ nome: s.nome, cargo: s.qualificacao })}
                    aria-pressed={ativo}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-ring ${
                      ativo ? 'border-indigo-500/50 bg-[var(--accent-soft)]' : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ativo ? 'bg-[var(--accent)] text-white' : 'bg-white/5 text-slate-400'}`}>
                      <UserRound size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-100">{s.nome}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {s.qualificacao}{s.desde ? ` · desde ${new Date(`${s.desde}T00:00:00Z`).getUTCFullYear()}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <input
            value={decisor?.nome ?? ''}
            onChange={(e) => onDecisor(e.target.value ? { nome: e.target.value, cargo: decisor?.cargo ?? '' } : null)}
            placeholder="Nome do contato"
            className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm focus-ring"
          />
          <input
            value={decisor?.cargo ?? ''}
            onChange={(e) => onDecisor({ nome: decisor?.nome ?? '', cargo: e.target.value })}
            placeholder="Cargo"
            className="h-9 rounded-lg border border-[var(--border)] px-3 text-sm focus-ring"
          />
        </div>
        <p className="text-[11px] text-slate-500">Sem contato definido, o lead entra só com a empresa e o e-mail da Receita.</p>
      </section>
    </div>
  )
}
