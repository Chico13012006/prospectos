'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Lock, Save, X } from 'lucide-react'
import {
  PORTES_PROSPECCAO,
  PROSPECCAO_LIMITES,
  UFS_BRASIL,
  type PorteProspeccao,
  type ProspeccaoConfig,
} from '@/lib/config/workspaceConfig'
import { formatarCnae, ROTULO_PORTE } from '@/lib/prospeccao/rotulos'
import CaixaSelecao from '@/components/prospeccao/CaixaSelecao'

// Perfil de busca da tela de Prospecção (organizacoes.configuracoes.prospeccao).
// É o ponto de partida dos filtros da busca e define quais CNAEs o catálogo da
// Receita precisa carregar para esta organização.
export default function PerfilProspeccaoPanel() {
  const [perfil, setPerfil] = useState<ProspeccaoConfig>({})
  const [cnaeDigitado, setCnaeDigitado] = useState('')
  const [podeEditar, setPodeEditar] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/configuracoes/workspace')
      .then(async (res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o perfil de busca.')
        return res.json()
      })
      .then(({ config, podeEditar: permitido }) => {
        setPerfil(config?.prospeccao ?? {})
        setPodeEditar(!!permitido)
      })
      .catch((e) => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
      .finally(() => setCarregando(false))
  }, [])

  const cnaes = perfil.cnaes ?? []
  const ufs = perfil.ufs ?? []
  const portes = perfil.portes ?? []

  function adicionarCnae() {
    const codigo = cnaeDigitado.replace(/\D/g, '')
    if (!/^\d{7}$/.test(codigo)) {
      setErro('CNAE deve ter 7 dígitos (ex.: 5510-8/01).')
      return
    }
    if (cnaes.length >= PROSPECCAO_LIMITES.cnaes) {
      setErro(`No máximo ${PROSPECCAO_LIMITES.cnaes} CNAEs por perfil.`)
      return
    }
    setErro(null)
    setPerfil((p) => ({ ...p, cnaes: [...new Set([...(p.cnaes ?? []), codigo])] }))
    setCnaeDigitado('')
  }

  function alternar<T extends string>(chave: 'ufs' | 'portes', valor: T) {
    setPerfil((p) => {
      const atual = (p[chave] ?? []) as T[]
      const proximo = atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor]
      return { ...p, [chave]: proximo }
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
        body: JSON.stringify({ prospeccao: cnaes.length ? perfil : null }),
      })
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(corpo?.erro || 'Falha ao salvar o perfil')
      setPerfil(corpo?.config?.prospeccao ?? {})
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2500)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <div className="text-sm text-slate-500">Carregando…</div>

  const chip = (ativo: boolean) =>
    `px-2.5 py-1 rounded-md text-xs border transition-colors focus-ring ${
      ativo
        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
        : 'border-[var(--border)] text-slate-400 hover:text-slate-200'
    } disabled:cursor-not-allowed`

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Perfil de busca da prospecção</h2>
        <p className="text-sm text-slate-400 mt-1">
          Define o que a tela de Prospecção busca por padrão no catálogo da Receita Federal. Os CNAEs daqui
          também dizem quais atividades o catálogo precisa carregar.
        </p>
      </div>

      {!podeEditar && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Lock size={13} /> Somente leitura — requer <code className="text-indigo-300">workspace.configure</code>.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-200">Atividades (CNAE principal)</h3>
        <div className="flex flex-wrap gap-2">
          {cnaes.length === 0 && <span className="text-xs text-slate-500">Nenhum CNAE — a busca fica desligada.</span>}
          {cnaes.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-200">
              {formatarCnae(c)}
              {podeEditar && (
                <button
                  aria-label={`Remover CNAE ${formatarCnae(c)}`}
                  onClick={() => setPerfil((p) => ({ ...p, cnaes: (p.cnaes ?? []).filter((x) => x !== c) }))}
                  className="text-slate-500 hover:text-slate-200"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
        {podeEditar && (
          <div className="flex gap-2">
            <input
              value={cnaeDigitado}
              onChange={(e) => setCnaeDigitado(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && adicionarCnae()}
              placeholder="Ex.: 5510-8/01"
              className="w-48 rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm text-slate-200 focus-ring"
            />
            <button onClick={adicionarCnae} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 focus-ring">
              Adicionar
            </button>
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <CaixaSelecao
            desabilitado={!podeEditar}
            marcado={!!perfil.incluirCnaesSecundarios}
            onChange={() => setPerfil((p) => ({ ...p, incluirCnaesSecundarios: !p.incluirCnaesSecundarios }))}
          />
          Incluir empresas que têm a atividade só como CNAE secundário
          <span className="text-slate-600">(traz empresas de outros ramos)</span>
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-200">Estados <span className="text-xs font-normal text-slate-500">— nenhum marcado = Brasil inteiro</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {UFS_BRASIL.map((uf) => (
            <button key={uf} disabled={!podeEditar} onClick={() => alternar('ufs', uf)} className={chip(ufs.includes(uf))}>
              {uf}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-slate-200">Porte <span className="text-xs font-normal text-slate-500">— nenhum marcado = todos</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {PORTES_PROSPECCAO.map((p: PorteProspeccao) => (
            <button key={p} disabled={!podeEditar} onClick={() => alternar('portes', p)} className={chip(portes.includes(p))}>
              {ROTULO_PORTE[p]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <CaixaSelecao
            desabilitado={!podeEditar}
            marcado={!!perfil.excluirMei}
            onChange={() => setPerfil((p) => ({ ...p, excluirMei: !p.excluirMei }))}
          />
          Excluir MEI
        </label>
      </section>

      {erro && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={14} /> {erro}
        </p>
      )}

      {podeEditar && (
        <div className="flex items-center gap-3">
          <button
            onClick={salvar}
            disabled={salvando}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-ring"
          >
            <Save size={14} /> {salvando ? 'Salvando…' : 'Salvar perfil'}
          </button>
          {salvo && (
            <span className="flex items-center gap-1 text-sm text-emerald-400">
              <Check size={14} /> Salvo
            </span>
          )}
        </div>
      )}
    </div>
  )
}
