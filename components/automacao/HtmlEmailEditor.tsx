'use client'

import { useId, useState } from 'react'
import { Code2, Eye, Trash2, Upload } from 'lucide-react'
import { documentoPreviewHtml, sanitizarHtmlEmail } from '@/lib/campanhas/emailCampanha'
import { LIMITE_HTML_CAMPANHA } from '@/lib/campanhas/configuracaoGuiada'

export default function HtmlEmailEditor({
  html,
  previewHtml,
  onChange,
  onErro,
}: {
  html?: string
  previewHtml: string
  onChange: (html: string | undefined) => void
  onErro: (mensagem: string) => void
}) {
  const inputId = useId()
  const [aba, setAba] = useState<'visual' | 'codigo'>('visual')

  async function importar(arquivo: File | undefined) {
    if (!arquivo) return
    if (arquivo.size > LIMITE_HTML_CAMPANHA) {
      onErro('O arquivo HTML precisa ter no máximo 200 KB.')
      return
    }
    const extensaoValida = /\.html?$/i.test(arquivo.name)
    if (!extensaoValida && arquivo.type !== 'text/html') {
      onErro('Selecione um arquivo .html ou .htm.')
      return
    }
    const conteudo = await arquivo.text()
    onChange(sanitizarHtmlEmail(conteudo))
    setAba('visual')
  }

  return (
    <div className="rounded-xl border border-[#30384e] bg-[#0d111b] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-200">HTML personalizado</div>
          <p className="mt-1 text-xs text-slate-500">Importe até 200 KB. Scripts, formulários e atributos perigosos são removidos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input id={inputId} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => void importar(e.target.files?.[0])} />
          <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/15">
            <Upload size={14} /> Importar HTML
          </label>
          {html && <button type="button" onClick={() => onChange(undefined)} className="inline-flex items-center gap-2 rounded-lg border border-[#30384e] px-3 py-2 text-xs text-slate-400 hover:text-red-300"><Trash2 size={14} /> Remover</button>}
        </div>
      </div>

      {html && <>
        <div className="mt-4 flex w-fit rounded-lg border border-[#30384e] bg-[#151924] p-1">
          <button type="button" onClick={() => setAba('visual')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${aba === 'visual' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500'}`}><Eye size={14} /> Visual</button>
          <button type="button" onClick={() => setAba('codigo')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${aba === 'codigo' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500'}`}><Code2 size={14} /> Código</button>
        </div>
        {aba === 'visual' ? (
          <iframe
            title="Prévia segura do HTML"
            sandbox=""
            srcDoc={documentoPreviewHtml(previewHtml)}
            className="mt-3 h-80 w-full rounded-xl border border-slate-200 bg-white"
          />
        ) : (
          <textarea
            className="mt-3 min-h-80 w-full resize-y rounded-xl border border-[#30384e] bg-[#080b12] p-4 font-mono text-xs leading-5 text-slate-300 focus:border-indigo-500 focus:outline-none"
            value={html}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        )}
      </>}
    </div>
  )
}
