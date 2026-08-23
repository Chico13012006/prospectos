'use client'

import { useId, useRef, useState, type DragEvent } from 'react'
import { Check, ClipboardPaste, Code2, Eye, FileCode2, Trash2, Upload } from 'lucide-react'
import { documentoPreviewHtml, extrairTextoHtmlEmail, sanitizarHtmlEmail } from '@/lib/campanhas/emailCampanha'
import { LIMITE_HTML_CAMPANHA } from '@/lib/campanhas/configuracaoGuiada'

export default function HtmlEmailEditor({
  html,
  previewHtml,
  titulo = 'HTML personalizado',
  descricao = 'Use um arquivo HTML/TXT ou cole o código. Scripts, formulários e atributos perigosos são removidos.',
  onChange,
  onErro,
}: {
  html?: string
  previewHtml: string
  titulo?: string
  descricao?: string
  onChange: (html: string | undefined, textoAlternativo?: string) => void
  onErro: (mensagem: string | null) => void
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [aba, setAba] = useState<'visual' | 'codigo' | 'colar'>('visual')
  const [codigoColado, setCodigoColado] = useState('')
  const [arquivo, setArquivo] = useState<{ nome: string; tamanho: number } | null>(null)
  const [arrastando, setArrastando] = useState(false)

  function aplicar(conteudo: string, origem?: { nome: string; tamanho: number }) {
    if (new TextEncoder().encode(conteudo).byteLength > LIMITE_HTML_CAMPANHA) {
      onErro('O HTML precisa ter no máximo 200 KB.')
      return
    }
    const sanitizado = sanitizarHtmlEmail(conteudo).trim()
    if (!sanitizado || !extrairTextoHtmlEmail(sanitizado)) {
      onErro('O arquivo ou código informado não possui conteúdo HTML utilizável.')
      return
    }
    onErro(null)
    onChange(sanitizado, extrairTextoHtmlEmail(sanitizado))
    setArquivo(origem ?? null)
    setCodigoColado('')
    setAba('visual')
  }

  async function lerArquivo(arquivoSelecionado: File): Promise<string> {
    const bytes = await arquivoSelecionado.arrayBuffer()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return new TextDecoder('windows-1252').decode(bytes)
    }
  }

  async function importar(arquivoSelecionado: File | undefined) {
    if (!arquivoSelecionado) return
    if (arquivoSelecionado.size > LIMITE_HTML_CAMPANHA) {
      onErro('O arquivo HTML precisa ter no máximo 200 KB.')
      return
    }
    const extensaoValida = /\.(?:html?|txt)$/i.test(arquivoSelecionado.name)
    if (!extensaoValida && !['text/html', 'text/plain'].includes(arquivoSelecionado.type)) {
      onErro('Selecione um arquivo .html, .htm ou .txt que contenha HTML.')
      return
    }
    try {
      aplicar(await lerArquivo(arquivoSelecionado), {
        nome: arquivoSelecionado.name,
        tamanho: arquivoSelecionado.size,
      })
    } catch {
      onErro('Não foi possível ler o arquivo selecionado.')
    } finally {
      // Permite selecionar novamente o mesmo arquivo depois de uma edição.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function soltar(evento: DragEvent<HTMLDivElement>) {
    evento.preventDefault()
    setArrastando(false)
    void importar(evento.dataTransfer.files?.[0])
  }

  function remover() {
    onErro(null)
    onChange(undefined)
    setArquivo(null)
    setCodigoColado('')
    setAba('visual')
  }

  return (
    <div className="rounded-xl border border-[#30384e] bg-[#0d111b] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-200">{titulo}</div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{descricao}</p>
        </div>
        {html && <button type="button" onClick={remover} className="inline-flex items-center gap-2 rounded-lg border border-[#30384e] px-3 py-2 text-xs text-slate-400 hover:text-red-300"><Trash2 size={14} /> Remover HTML</button>}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept=".html,.htm,.txt,text/html,text/plain"
        className="hidden"
        onChange={(e) => void importar(e.target.files?.[0])}
      />

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div
          onDragEnter={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
          className={`rounded-xl border border-dashed p-4 transition-colors ${arrastando ? 'border-indigo-400 bg-indigo-500/15' : 'border-[#3a435b] bg-[#111621]'}`}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300"><Upload size={18} /></span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-200">Carregar um arquivo</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Arraste aqui ou escolha um arquivo `.html`, `.htm` ou `.txt`. O seletor não importa pastas.</p>
              <label htmlFor={inputId} className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/15">
                <FileCode2 size={14} /> {html ? 'Substituir arquivo' : 'Escolher arquivo'}
              </label>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setAba('colar')}
          className={`rounded-xl border p-4 text-left transition-colors ${aba === 'colar' ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-[#30384e] bg-[#111621] hover:border-[#46506d]'}`}
        >
          <span className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300"><ClipboardPaste size={18} /></span>
            <span>
              <span className="block text-sm font-medium text-slate-200">Colar código HTML</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">Use esta opção quando o HTML estiver em um editor, gerador ou arquivo que o Windows não exibe.</span>
            </span>
          </span>
        </button>
      </div>

      {arquivo && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
          <Check size={14} className="shrink-0" />
          <span className="truncate">{arquivo.nome}</span>
          <span className="shrink-0 text-emerald-400/70">({Math.max(1, Math.round(arquivo.tamanho / 1024))} KB)</span>
        </div>
      )}

      {aba === 'colar' && (
        <div className="mt-4 rounded-xl border border-[#30384e] bg-[#080b12] p-3">
          <label className="text-xs font-medium text-slate-300">Cole o código completo abaixo</label>
          <textarea
            autoFocus
            className="mt-2 min-h-56 w-full resize-y rounded-lg border border-[#30384e] bg-[#05070c] p-4 font-mono text-xs leading-5 text-slate-300 focus:border-indigo-500 focus:outline-none"
            value={codigoColado}
            onChange={(e) => setCodigoColado(e.target.value)}
            placeholder={'<html>\n  <body>\n    <p>Olá, {nome}.</p>\n  </body>\n</html>'}
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600">Limite de 200 KB. O código será sanitizado antes da prévia.</span>
            <button type="button" onClick={() => aplicar(codigoColado)} disabled={!codigoColado.trim()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">
              <Check size={14} /> Aplicar e visualizar
            </button>
          </div>
        </div>
      )}

      {html && aba !== 'colar' && <>
        <div className="mt-4 flex w-fit rounded-lg border border-[#30384e] bg-[#151924] p-1">
          <button type="button" onClick={() => setAba('visual')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${aba === 'visual' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500'}`}><Eye size={14} /> Visual</button>
          <button type="button" onClick={() => setAba('codigo')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${aba === 'codigo' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500'}`}><Code2 size={14} /> Código</button>
          <button type="button" onClick={() => setAba('colar')} className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-slate-500"><ClipboardPaste size={14} /> Colar outro</button>
        </div>
        {aba === 'visual' ? (
          <iframe
            title="Prévia segura do HTML"
            sandbox=""
            srcDoc={documentoPreviewHtml(previewHtml)}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white"
            style={{ height: '36rem' }}
          />
        ) : (
          <textarea
            className="mt-3 min-h-80 w-full resize-y rounded-xl border border-[#30384e] bg-[#080b12] p-4 font-mono text-xs leading-5 text-slate-300 focus:border-indigo-500 focus:outline-none"
            value={html}
            onChange={(e) => {
              if (new TextEncoder().encode(e.target.value).byteLength > LIMITE_HTML_CAMPANHA) {
                onErro('O HTML precisa ter no máximo 200 KB.')
                return
              }
              onErro(null)
              onChange(e.target.value)
            }}
            spellCheck={false}
          />
        )}
      </>}
    </div>
  )
}
