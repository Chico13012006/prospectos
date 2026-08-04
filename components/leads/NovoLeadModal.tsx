'use client'

import { useState } from 'react'
import { X, Loader2, UserPlus } from 'lucide-react'
import { ORIGENS, ORIGEM_OUTRO } from '@/lib/leads/origens'

// Modal de cadastro MANUAL de 1 lead (2.3). Os 4 obrigatórios (nome, e-mail,
// empresa, origem) + opcionais. O responsável é definido no server (usuário
// logado) — aqui não há seletor. Ao salvar, chama onCreated e fecha.
const inputCls =
  'w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50'
const labelCls = 'block text-sm text-slate-400 mb-1.5'

export default function NovoLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [origem, setOrigem] = useState<string>('')
  const [origemOutro, setOrigemOutro] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cargo, setCargo] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const origemFinal = origem === ORIGEM_OUTRO ? origemOutro.trim() || ORIGEM_OUTRO : origem
  const valido = nome.trim() && email.trim() && empresa.trim() && origem

  async function salvar() {
    if (!valido || salvando) return
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim(),
          empresa: empresa.trim(),
          origem: origemFinal,
          telefone: telefone.trim() || undefined,
          cargo: cargo.trim() || undefined,
          cidade: cidade.trim() || undefined,
          estado: estado.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro([data.erro, data.detalhe].filter(Boolean).join(' — ') || 'Não foi possível criar o lead.')
        return
      }
      onCreated()
      onClose()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={() => !salvando && onClose()}
    >
      <div
        className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Novo lead"
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
            <UserPlus size={18} className="text-indigo-400" /> Novo lead
          </h3>
          <button onClick={() => !salvando && onClose()} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Nome <span className="text-rose-400">*</span></label>
            <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} placeholder="Nome do contato" />
          </div>
          <div>
            <label className={labelCls}>E-mail <span className="text-rose-400">*</span></label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="contato@empresa.com" type="email" />
          </div>
          <div>
            <label className={labelCls}>Empresa <span className="text-rose-400">*</span></label>
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={inputCls} placeholder="Nome da empresa" />
          </div>
          <div>
            <label className={labelCls}>Origem <span className="text-rose-400">*</span></label>
            <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={inputCls}>
              <option value="">Selecione…</option>
              {ORIGENS.map((o) => (<option key={o} value={o}>{o}</option>))}
            </select>
          </div>
          {origem === ORIGEM_OUTRO && (
            <div>
              <label className={labelCls}>Qual origem?</label>
              <input value={origemOutro} onChange={(e) => setOrigemOutro(e.target.value)} className={inputCls} placeholder="Descreva a origem" />
            </div>
          )}
          <div>
            <label className={labelCls}>Telefone</label>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Cargo</label>
            <input value={cargo} onChange={(e) => setCargo(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Cidade</label>
            <input value={cidade} onChange={(e) => setCidade(e.target.value)} className={inputCls} placeholder="(opcional)" />
          </div>
          <div>
            <label className={labelCls}>Estado (UF)</label>
            <input value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls} placeholder="(opcional)" maxLength={2} />
          </div>
        </div>

        {erro && <p className="text-sm text-rose-400 mt-4">{erro}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} disabled={salvando} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[#0f1117]">Cancelar</button>
          <button
            onClick={salvar}
            disabled={!valido || salvando}
            className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: '#1e3a5f' }}
          >
            {salvando && <Loader2 size={14} className="animate-spin" />} Criar lead
          </button>
        </div>
      </div>
    </div>
  )
}
