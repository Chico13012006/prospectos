'use client'

// Criar/editar um template da biblioteca. Canal, chave e segmento são a
// identidade do template (workflows e campanhas o encontram por eles): ficam
// travados na edição, como a API também impõe. HTML reaproveita o
// HtmlEmailEditor e a prévia usa o mesmo caminho do envio real.
import { useMemo, useState } from 'react'
import { Check, Copy, Eye, Loader2, X } from 'lucide-react'
import HtmlEmailEditor from '@/components/automacao/HtmlEmailEditor'
import PreviaEmailModal from '@/components/automacao/PreviaEmailModal'
import { atualizarTemplateBiblioteca, criarTemplateBiblioteca } from '@/lib/api'
import { CANAIS_NOVO_TEMPLATE, rotuloCanal } from '@/lib/templates/biblioteca'
import { VARIAVEIS_TEMPLATE, previaTemplate } from '@/lib/templates/previa'
import type { CanalTemplate, FormatoTemplate, TemplateBiblioteca } from '@/lib/templates/tipos'

const campo = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none'
const rotulo = 'text-xs font-medium text-slate-400 block mb-1'

export default function TemplateEditorModal({
  template,
  tiposConhecidos,
  nichosConhecidos,
  onFechar,
  onSalvo,
}: {
  template: TemplateBiblioteca | null
  tiposConhecidos: string[]
  nichosConhecidos: string[]
  onFechar: () => void
  onSalvo: (template: TemplateBiblioteca) => void
}) {
  const edicao = !!template
  const [nome, setNome] = useState(template?.nome ?? '')
  const [canal, setCanal] = useState<CanalTemplate>(template?.canal ?? 'email')
  const [tipo, setTipo] = useState(template?.tipo ?? '')
  const [nicho, setNicho] = useState(template?.nicho ?? '')
  const [assunto, setAssunto] = useState(template?.assunto ?? '')
  const [corpo, setCorpo] = useState(template?.corpo ?? '')
  const [html, setHtml] = useState<string | undefined>(template?.html ?? undefined)
  const [formato, setFormato] = useState<FormatoTemplate>(template?.formato ?? 'texto')
  const [ativo, setAtivo] = useState(template?.ativo ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [previaAberta, setPreviaAberta] = useState(false)
  const [abaPrevia, setAbaPrevia] = useState<'visual' | 'codigo'>('visual')
  const [copiada, setCopiada] = useState<string | null>(null)

  const ehEmail = canal === 'email'
  const usaHtml = ehEmail && formato === 'html'
  const previa = useMemo(
    () => previaTemplate({ canal, assunto, corpo, html: usaHtml ? html ?? null : null }),
    [canal, assunto, corpo, html, usaHtml],
  )

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const conteudo = {
        nome,
        corpo,
        ativo,
        ...(ehEmail ? { assunto } : {}),
        html: usaHtml ? html ?? '' : '',
      }
      const salvo = edicao
        ? await atualizarTemplateBiblioteca(template.id, conteudo)
        : await criarTemplateBiblioteca({ ...conteudo, canal, tipo, nicho: nicho || null })
      onSalvo(salvo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o template.')
    } finally {
      setSalvando(false)
    }
  }

  function copiarVariavel(variavel: string) {
    navigator.clipboard?.writeText(`{{${variavel}}}`)
      .then(() => setCopiada(variavel))
      .catch(() => setCopiada(null))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-subtle)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">{edicao ? 'Editar template' : 'Novo template'}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {edicao
                ? 'Canal, chave e segmento não mudam depois de criados — workflows e campanhas encontram o template por eles.'
                : 'A chave é como workflows e campanhas vão pedir este template. Ela não muda depois.'}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg border border-[var(--border-strong)] p-1.5 text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={rotulo}>Nome</label>
            <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Renovação do laudo" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={rotulo}>Canal</label>
              {edicao ? (
                <div className={`${campo} text-slate-400`}>{rotuloCanal(canal)}</div>
              ) : (
                <select className={campo} value={canal} onChange={(e) => { setCanal(e.target.value as CanalTemplate); setFormato('texto') }}>
                  {CANAIS_NOVO_TEMPLATE.map((c) => <option key={c.valor} value={c.valor}>{c.label}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className={rotulo}>Chave (estágio)</label>
              {edicao ? (
                <div className={`${campo} truncate text-slate-400`}>{tipo}</div>
              ) : (
                <>
                  <input className={campo} list="tipos-conhecidos" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="ex.: renovacao_1" />
                  <datalist id="tipos-conhecidos">{tiposConhecidos.map((t) => <option key={t} value={t} />)}</datalist>
                </>
              )}
            </div>
            <div>
              <label className={rotulo}>Segmento</label>
              {edicao ? (
                <div className={`${campo} truncate text-slate-400`}>{nicho || 'Genérico'}</div>
              ) : (
                <>
                  <input className={campo} list="nichos-conhecidos" value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Genérico" />
                  <datalist id="nichos-conhecidos">{nichosConhecidos.map((n) => <option key={n} value={n} />)}</datalist>
                </>
              )}
            </div>
          </div>

          {ehEmail && (
            <>
              <div>
                <label className={rotulo}>Assunto</label>
                <input className={campo} value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Validade do laudo em {{data_validade}}" />
              </div>
              <div className="flex items-center gap-2">
                <span className={rotulo}>Formato</span>
                {(['texto', 'html'] as FormatoTemplate[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormato(f)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${formato === f ? 'border-indigo-400 bg-indigo-500/10 text-indigo-300' : 'border-[var(--border)] text-slate-400 hover:text-slate-200'}`}
                  >
                    {f === 'html' ? 'HTML' : 'Texto'}
                  </button>
                ))}
              </div>
            </>
          )}

          <div>
            <label className={rotulo}>{usaHtml ? 'Texto alternativo (para quem não lê HTML)' : 'Mensagem'}</label>
            <textarea className={`${campo} resize-y`} rows={usaHtml ? 4 : 8} value={corpo} onChange={(e) => setCorpo(e.target.value)} placeholder="Olá {{nome}}, tudo bem?" />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {VARIAVEIS_TEMPLATE.map((v) => (
                <button key={v} type="button" onClick={() => copiarVariavel(v)} title="Copiar variável"
                  className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] text-blue-300 hover:bg-blue-500/25">
                  {copiada === v ? <Check size={11} /> : <Copy size={11} />} {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {usaHtml && (
            <HtmlEmailEditor
              html={html}
              previewHtml={previa.html ?? ''}
              titulo="HTML do e-mail"
              descricao="Carregue um arquivo HTML, arraste-o aqui ou cole o código. Scripts e atributos perigosos são removidos."
              onChange={(novoHtml, textoAlternativo) => {
                setHtml(novoHtml)
                if (textoAlternativo && !corpo.trim()) setCorpo(textoAlternativo)
              }}
              onErro={setErro}
            />
          )}

          {!ehEmail && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-base)] p-3">
              <div className="mb-2 text-xs font-medium text-slate-400">Prévia com dados de exemplo</div>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-200">{previa.texto || '—'}</pre>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Template ativo
          </label>

          {erro && <p className="text-sm text-red-400">{erro}</p>}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {ehEmail && (
              <button type="button" onClick={() => setPreviaAberta(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--bg-input)]">
                <Eye size={14} /> Ver prévia
              </button>
            )}
            <button type="button" onClick={onFechar} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-slate-300 hover:bg-[var(--bg-input)]">Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {salvando ? 'Salvando…' : edicao ? 'Salvar alterações' : 'Criar template'}
            </button>
          </div>
        </div>

        <PreviaEmailModal
          aberto={previaAberta}
          onFechar={() => setPreviaAberta(false)}
          titulo={nome || 'Prévia do template'}
          assunto={previa.assunto}
          html={previa.html ?? ''}
          codigo={usaHtml ? html : undefined}
          aba={abaPrevia}
          onAba={setAbaPrevia}
        />
      </div>
    </div>
  )
}
