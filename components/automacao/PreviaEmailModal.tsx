'use client'

import { useEffect } from 'react'
import { Code2, Eye, X } from 'lucide-react'
import { documentoPreviewHtml } from '@/lib/campanhas/emailCampanha'

// Prévia do e-mail em popup. Antes a mesma mensagem era renderizada DUAS vezes
// na própria página (uma dentro do editor de HTML, outra na seção "Prévia da
// mensagem"), cada uma com 36rem de altura fixa — a etapa virava uma rolagem
// longa e ninguém via o formulário e o resultado juntos.
//
// Aqui a prévia rola DENTRO do modal e o fundo fica travado, então a posição da
// página é preservada ao fechar. O iframe continua com sandbox vazio: o HTML é
// de terceiros e não pode executar nada.
export default function PreviaEmailModal({
  aberto,
  onFechar,
  titulo,
  de,
  assunto,
  html,
  codigo,
  aba,
  onAba,
}: {
  aberto: boolean
  onFechar: () => void
  titulo: string
  de?: string | null
  assunto?: string | null
  html: string
  codigo?: string
  aba: 'visual' | 'codigo'
  onAba: (aba: 'visual' | 'codigo') => void
}) {
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', aoTeclar)
    // Trava a rolagem do fundo para o modal não "arrastar" a página atrás.
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflowAnterior
    }
  }, [aberto, onFechar])

  if (!aberto) return null

  const temCodigo = typeof codigo === 'string' && codigo.length > 0
  const abaAtual = temCodigo ? aba : 'visual'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onFechar}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div
        className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#2a3147] bg-[#12161f] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#2a3147] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">{titulo}</h2>
            <p className="mt-0.5 text-xs text-slate-500">Exatamente o conteúdo sanitizado que sai para o destinatário.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {temCodigo && (
              <div className="flex rounded-lg border border-[#30384e] bg-[#151924] p-1">
                <button type="button" onClick={() => onAba('visual')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${abaAtual === 'visual' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`}>
                  <Eye size={13} /> Visual
                </button>
                <button type="button" onClick={() => onAba('codigo')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${abaAtual === 'codigo' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`}>
                  <Code2 size={13} /> Código
                </button>
              </div>
            )}
            <button type="button" onClick={onFechar} aria-label="Fechar prévia"
              className="rounded-lg border border-[#30384e] p-1.5 text-slate-400 hover:text-slate-200">
              <X size={16} />
            </button>
          </div>
        </div>

        {(de || assunto) && (
          <div className="border-b border-[#2a3147] bg-[#0d111b] px-5 py-2.5 text-xs text-slate-400">
            {de && <div><span className="text-slate-500">De:</span> {de}</div>}
            {assunto && <div className="mt-0.5"><span className="text-slate-500">Assunto:</span> {assunto}</div>}
          </div>
        )}

        {/* min-h-0 é o que permite o filho rolar dentro de um flex column. */}
        <div className="min-h-0 flex-1 bg-white">
          {abaAtual === 'visual' ? (
            <iframe
              title={titulo}
              sandbox=""
              srcDoc={documentoPreviewHtml(html)}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <pre className="h-full overflow-auto bg-[#080b12] p-4 font-mono text-xs leading-5 text-slate-300">
              {codigo}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
