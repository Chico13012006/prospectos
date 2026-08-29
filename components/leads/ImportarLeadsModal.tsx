'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react'

// Modal de importação em LOTE (2.2). Fluxo: (1) escolhe o CSV → (2) preview com
// contagens (o server parseia/valida/dedupe) → (3) escolhe o comercial
// responsável (GET /api/equipe/listar) → (4) confirma → insere. O parsing e a
// inserção rodam server-side (/api/leads/importar), nunca no client.
type Resumo = {
  totalLinhas: number
  validas: number
  pulados: Record<string, number>
  duplicadosNoArquivo: number
  jaExistentes: number
  novos: number
  nichos: Array<{ nicho: string; leads: number; templateAtivo: boolean }>
}
type Membro = { id: string; nome: string | null; email: string | null }

const MOTIVO_LABEL: Record<string, string> = {
  sem_nome: 'sem nome',
  sem_email: 'sem e-mail',
  email_invalido: 'e-mail inválido',
  sem_empresa: 'sem empresa',
  sem_segmento: 'sem nicho/segmento',
}

function rotuloNicho(nicho: string): string {
  const texto = nicho.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export default function ImportarLeadsModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [membros, setMembros] = useState<Membro[]>([])
  const [responsavel, setResponsavel] = useState('')
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [inserindo, setInserindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<{ inseridos: number; responsavel?: string } | null>(null)

  // Equipe para o seletor de responsável (endpoint já existente).
  useEffect(() => {
    fetch('/api/equipe/listar')
      .then((r) => r.json())
      .then((d) => setMembros((d.membros ?? []).filter((m: Membro) => m.nome || m.email)))
      .catch(() => {})
  }, [])

  async function escolherArquivo(f: File | null) {
    setFile(f)
    setResumo(null)
    setErro(null)
    if (!f) return
    setCarregandoPrevia(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('modo', 'previa')
      const res = await fetch('/api/leads/importar', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(data.erro || 'Não foi possível ler o arquivo.'); return }
      setResumo(data.resumo)
    } catch {
      setErro('Erro ao enviar o arquivo.')
    } finally {
      setCarregandoPrevia(false)
    }
  }

  async function confirmar() {
    if (!file || !responsavel || inserindo) return
    setInserindo(true)
    setErro(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('modo', 'confirmar')
      fd.append('responsavelAuthId', responsavel)
      const res = await fetch('/api/leads/importar', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro([data.erro, data.detalhe].filter(Boolean).join(' — ') || 'Falha ao importar.')
        return
      }
      setFeito({ inseridos: data.inseridos ?? 0, responsavel: data.responsavel?.nome })
      onImported()
    } catch {
      setErro('Erro de conexão ao importar.')
    } finally {
      setInserindo(false)
    }
  }

  const pulosTexto = resumo
    ? Object.entries(resumo.pulados).map(([m, n]) => `${n} ${MOTIVO_LABEL[m] ?? m}`).join(', ')
    : ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !inserindo && onClose()}>
      <div className="bg-[#1a1f2e] rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Importar leads">
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
            <FileSpreadsheet size={18} className="text-indigo-400" /> Importar leads
          </h3>
          <button onClick={() => !inserindo && onClose()} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
        </div>

        {feito ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="text-slate-100 font-medium">{feito.inseridos} lead{feito.inseridos === 1 ? '' : 's'} importado{feito.inseridos === 1 ? '' : 's'}</p>
            {feito.responsavel && <p className="text-sm text-slate-400">Responsável: {feito.responsavel}</p>}
            <button onClick={onClose} className="mt-2 text-sm px-4 py-2 rounded-lg text-white font-medium" style={{ backgroundColor: '#1e3a5f' }}>Fechar</button>
          </div>
        ) : (
          <>
            {/* 1) Upload */}
            <label className="block text-sm text-slate-400 mb-1.5">Arquivo CSV</label>
            <label className="flex items-center gap-2 cursor-pointer bg-[#0f1117] border border-dashed border-[#2a3147] rounded-lg px-3 py-3 text-sm text-slate-300 hover:border-blue-500/50">
              <Upload size={16} className="text-slate-500" />
              <span className="truncate">{file ? file.name : 'Escolher arquivo…'}</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)} />
            </label>
            <p className="text-xs text-slate-600 mt-1.5">
              Obrigatórias: <span className="text-slate-500">Nome, E-mail, Empresa, Nicho/Segmento</span> · Opcionais: Origem, Telefone, Cargo, Cidade e Estado.
            </p>

            {carregandoPrevia && (
              <div className="flex items-center gap-2 text-sm text-slate-400 mt-4"><Loader2 size={14} className="animate-spin" /> Lendo arquivo…</div>
            )}

            {/* 2) Preview */}
            {resumo && (
              <div className="mt-4 rounded-lg border border-[#2a3147] bg-[#0f1117] p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-400">Linhas no arquivo</span><span className="text-slate-200 tabular-nums">{resumo.totalLinhas}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Válidas</span><span className="text-slate-200 tabular-nums">{resumo.validas}</span></div>
                {resumo.duplicadosNoArquivo > 0 && <div className="flex justify-between"><span className="text-slate-400">Duplicadas no arquivo</span><span className="text-slate-300 tabular-nums">{resumo.duplicadosNoArquivo}</span></div>}
                {resumo.jaExistentes > 0 && <div className="flex justify-between"><span className="text-slate-400">Já existem na base</span><span className="text-slate-300 tabular-nums">{resumo.jaExistentes}</span></div>}
                {pulosTexto && <div className="flex justify-between gap-3"><span className="text-slate-400">Puladas</span><span className="text-amber-300/80 text-right">{pulosTexto}</span></div>}
                <div className="flex justify-between pt-1 border-t border-[#2a3147] mt-1"><span className="text-slate-200 font-medium">A inserir</span><span className="text-emerald-400 font-semibold tabular-nums">{resumo.novos}</span></div>
                {resumo.nichos.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-[#2a3147] space-y-1.5">
                    <p className="text-xs font-medium text-slate-400">Nichos dos novos leads</p>
                    {resumo.nichos.map((item) => (
                      <div key={item.nicho} className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-slate-300">{rotuloNicho(item.nicho)} · {item.leads} lead{item.leads === 1 ? '' : 's'}</span>
                        <span className={item.templateAtivo ? 'text-emerald-400' : 'text-amber-300'}>
                          {item.templateAtivo ? 'template pronto' : 'sem template de 1º contato'}
                        </span>
                      </div>
                    ))}
                    {resumo.nichos.some((item) => !item.templateAtivo) && (
                      <p className="text-xs leading-5 text-amber-300/80">
                        Esses leads podem ser importados, mas o primeiro e-mail fica bloqueado até existir um template para o nicho.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3) Responsável */}
            {resumo && resumo.novos > 0 && (
              <div className="mt-4">
                <label className="block text-sm text-slate-400 mb-1.5">Comercial responsável <span className="text-rose-400">*</span></label>
                <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="w-full bg-[#0f1117] border border-[#2a3147] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50">
                  <option value="">Selecione…</option>
                  {membros.map((m) => (<option key={m.id} value={m.id}>{m.nome || m.email}</option>))}
                </select>
                <p className="text-xs text-slate-600 mt-1.5">Todos os {resumo.novos} leads deste upload vão para essa pessoa (entra em cópia nos follow-ups).</p>
              </div>
            )}

            {erro && <p className="text-sm text-rose-400 mt-4">{erro}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} disabled={inserindo} className="text-sm px-4 py-2 rounded-lg text-slate-300 hover:bg-[#0f1117]">Cancelar</button>
              <button
                onClick={confirmar}
                disabled={!file || !resumo || resumo.novos === 0 || !responsavel || inserindo}
                className="text-sm px-4 py-2 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                {inserindo && <Loader2 size={14} className="animate-spin" />} Importar {resumo && resumo.novos > 0 ? `${resumo.novos}` : ''}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
