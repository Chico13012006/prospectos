'use client'

// Criar/editar um template da biblioteca. Canal, chave e segmento são a
// identidade do template (workflows e campanhas o encontram por eles): ficam
// travados na edição, como a API também impõe. HTML reaproveita o
// HtmlEmailEditor e a prévia usa o mesmo caminho do envio real. A validação da
// tela é a MESMA do servidor (validarNovoTemplate/validarEdicaoTemplate): o
// botão só libera quando a API aceitaria.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, Check, Eye, FileText, IdCard, Loader2, Lock, Mail, MessageCircle, PenLine, Plus, X,
} from 'lucide-react'
import HtmlEmailEditor from '@/components/automacao/HtmlEmailEditor'
import PreviaEmailModal from '@/components/automacao/PreviaEmailModal'
import { atualizarTemplateBiblioteca, criarTemplateBiblioteca } from '@/lib/api'
import { CANAIS_NOVO_TEMPLATE, rotuloCanal } from '@/lib/templates/biblioteca'
import { previaTemplate, variaveisDoTemplate } from '@/lib/templates/previa'
import { ESTAGIOS_DESTINO_KANBAN } from '@/lib/pipeline/mensagemEtapa'
import {
  LIMITE_ASSUNTO_TEMPLATE, LIMITE_NOME_TEMPLATE, validarEdicaoTemplate, validarNovoTemplate,
  type CanalTemplate, type FormatoTemplate, type TemplateBiblioteca,
} from '@/lib/templates/tipos'
import s from './TemplateEditor.module.css'

const ICONE_CANAL: Partial<Record<CanalTemplate, typeof Mail>> = { email: Mail, whatsapp: MessageCircle }

/** Chave como o servidor grava: minúsculas, espaço vira "_". */
const normalizarChave = (v: string) => v.toLowerCase().replace(/\s+/g, '_')

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
  // Onde a variável clicada entra: último campo de texto focado.
  const [alvoVariavel, setAlvoVariavel] = useState<'assunto' | 'corpo'>('corpo')
  const refAssunto = useRef<HTMLInputElement>(null)
  const refCorpo = useRef<HTMLTextAreaElement>(null)

  const ehEmail = canal === 'email'
  const usaHtml = ehEmail && formato === 'html'
  const previa = useMemo(
    () => previaTemplate({ canal, assunto, corpo, html: usaHtml ? html ?? null : null, tipo }),
    [canal, assunto, corpo, html, usaHtml, tipo],
  )

  const conteudo = useMemo(() => ({
    nome,
    corpo,
    ativo,
    ...(ehEmail ? { assunto } : {}),
    html: usaHtml ? html ?? '' : '',
  }), [nome, corpo, ativo, ehEmail, assunto, usaHtml, html])

  // Mesma regra da API: o que falta aparece no rodapé e trava o botão.
  const pendencia = useMemo(() => {
    const r = template
      ? validarEdicaoTemplate(template, conteudo)
      : validarNovoTemplate({ ...conteudo, canal, tipo, nicho: nicho || null })
    return r.ok ? null : r.erro
  }, [template, conteudo, canal, tipo, nicho])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !previaAberta && !salvando) onFechar() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onFechar, previaAberta, salvando])

  async function salvar() {
    if (pendencia) return
    setSalvando(true)
    setErro(null)
    try {
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

  // Insere {{variavel}} na posição do cursor do último campo focado.
  function inserirVariavel(variavel: string) {
    const trecho = `{{${variavel}}}`
    const alvo = alvoVariavel === 'assunto' && ehEmail ? refAssunto.current : refCorpo.current
    const atual = alvoVariavel === 'assunto' && ehEmail ? assunto : corpo
    const inicio = alvo?.selectionStart ?? atual.length
    const fim = alvo?.selectionEnd ?? atual.length
    const novo = atual.slice(0, inicio) + trecho + atual.slice(fim)
    if (alvoVariavel === 'assunto' && ehEmail) setAssunto(novo)
    else setCorpo(novo)
    requestAnimationFrame(() => {
      if (!alvo) return
      alvo.focus()
      const pos = inicio + trecho.length
      alvo.setSelectionRange(pos, pos)
    })
  }

  const IconeCanal = ICONE_CANAL[canal] ?? FileText

  return (
    <div className={s.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar() }}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="template-editor-titulo">
        <header className={s.topo}>
          <div className={s.topoTitulo}>
            <span className={s.topoIcone}>{edicao ? <PenLine size={18} /> : <Plus size={19} />}</span>
            <div>
              <h3 id="template-editor-titulo">{edicao ? 'Editar template' : 'Novo template'}</h3>
              <p>
                {edicao
                  ? 'Canal, chave e segmento não mudam depois de criados — workflows e campanhas encontram o template por eles.'
                  : 'A chave é como workflows e campanhas vão pedir este template. Ela não muda depois.'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className={`${s.fechar} focus-ring`}><X size={16} /></button>
        </header>

        <div className={s.corpo}>
          <div className={s.formulario}>
            {/* Identificação */}
            <section className={s.secao}>
              <div className={s.secaoTitulo}><IdCard size={13} /> Identificação</div>

              <label className={s.rotulo}>
                <span>Nome <small>{nome.trim().length}/{LIMITE_NOME_TEMPLATE}</small></span>
                <input className={s.campo} value={nome} maxLength={LIMITE_NOME_TEMPLATE} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Renovação do laudo" />
              </label>

              <div className={s.rotulo}>
                <span>Canal</span>
                {edicao ? (
                  <div className={s.travado}><Lock size={13} /> <IconeCanal size={14} /> {rotuloCanal(canal)}</div>
                ) : (
                  <div className={s.segmentado} role="group" aria-label="Canal">
                    {CANAIS_NOVO_TEMPLATE.map((c) => {
                      const Icone = ICONE_CANAL[c.valor] ?? FileText
                      return (
                        <button
                          key={c.valor}
                          type="button"
                          aria-pressed={canal === c.valor}
                          onClick={() => { setCanal(c.valor); setFormato('texto'); setAlvoVariavel('corpo') }}
                          className={`${canal === c.valor ? s.ativo : ''} focus-ring`}
                        >
                          <Icone size={14} /> {c.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className={s.grade3}>
                <label className={`${s.rotulo} col-span-2 max-[640px]:col-span-1`}>
                  <span>Chave (estágio)</span>
                  {edicao ? (
                    <div className={`${s.travado} truncate`}><Lock size={13} /> <span className="truncate font-mono text-xs">{tipo}</span></div>
                  ) : (
                    <>
                      <input
                        className={`${s.campo} ${s.campoMono}`}
                        list="tipos-conhecidos"
                        value={tipo}
                        onChange={(e) => setTipo(normalizarChave(e.target.value))}
                        placeholder="ex.: renovacao_1"
                      />
                      <datalist id="tipos-conhecidos">{[...new Set([...tiposConhecidos, ...ESTAGIOS_DESTINO_KANBAN])].map((t) => <option key={t} value={t} />)}</datalist>
                    </>
                  )}
                </label>
                <label className={s.rotulo}>
                  <span>Segmento</span>
                  {edicao ? (
                    <div className={`${s.travado} truncate`}><Lock size={13} /> <span className="truncate">{nicho || 'Genérico'}</span></div>
                  ) : (
                    <>
                      <input className={s.campo} list="nichos-conhecidos" value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Genérico" />
                      <datalist id="nichos-conhecidos">{nichosConhecidos.map((n) => <option key={n} value={n} />)}</datalist>
                    </>
                  )}
                </label>
              </div>
              {!edicao && (
                <p className={`${s.dica} -mt-1.5`}>
                  Chave: letras minúsculas, números e _. Segmento vazio = vale para todos.
                  Para a mensagem de uma etapa do Kanban (&quot;Mover e enviar&quot;), use a chave da etapa:
                  {' '}<code>respondeu</code>, <code>reuniao_agendada</code> ou <code>ganho</code>.
                </p>
              )}
            </section>

            {/* Conteúdo */}
            <section className={s.secao}>
              <div className={s.secaoTitulo}><IconeCanal size={13} /> Conteúdo</div>

              {ehEmail && (
                <>
                  <label className={s.rotulo}>
                    <span>Assunto <small>{assunto.length}/{LIMITE_ASSUNTO_TEMPLATE}</small></span>
                    <input
                      ref={refAssunto}
                      className={s.campo}
                      value={assunto}
                      maxLength={LIMITE_ASSUNTO_TEMPLATE}
                      onChange={(e) => setAssunto(e.target.value)}
                      onFocus={() => setAlvoVariavel('assunto')}
                      placeholder="Validade do laudo em {{data_validade}}"
                    />
                  </label>
                  <div className={s.rotulo}>
                    <span>Formato</span>
                    <div className={s.segmentado} role="group" aria-label="Formato">
                      {(['texto', 'html'] as FormatoTemplate[]).map((f) => (
                        <button key={f} type="button" aria-pressed={formato === f} onClick={() => setFormato(f)} className={`${formato === f ? s.ativo : ''} focus-ring`}>
                          {f === 'html' ? 'HTML' : 'Texto'}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <label className={s.rotulo}>
                <span>
                  {usaHtml ? 'Texto alternativo (para quem não lê HTML)' : 'Mensagem'}
                  <small>{corpo.length.toLocaleString('pt-BR')} caracteres</small>
                </span>
                <textarea
                  ref={refCorpo}
                  className={s.campo}
                  rows={usaHtml ? 4 : 9}
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  onFocus={() => setAlvoVariavel('corpo')}
                  placeholder="Olá {{nome}}, tudo bem?"
                />
              </label>

              <div className={s.variaveis}>
                <span>Inserir no {alvoVariavel === 'assunto' && ehEmail ? 'assunto' : 'texto'}:</span>
                {variaveisDoTemplate(tipo).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => inserirVariavel(v)}
                    title={`Inserir {{${v}}} na posição do cursor`}
                    className={`${s.variavel} focus-ring`}
                  >
                    <Plus size={10} /> {v}
                  </button>
                ))}
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
            </section>
          </div>

          {/* Prévia ao vivo */}
          <aside className={s.lateral} aria-label="Prévia">
            <div className={s.previaTitulo}>
              <strong><Eye size={14} /> Prévia</strong>
              <small>com dados de exemplo</small>
            </div>
            {ehEmail ? (
              <div className={s.email}>
                <div className={s.emailCabecalho}>
                  Para: <b>contato@empresa-exemplo.com.br</b>
                  <div className={s.emailAssunto}>{previa.assunto || <span className={s.vazioTexto}>Sem assunto</span>}</div>
                </div>
                {usaHtml && previa.html ? (
                  <iframe title="Prévia do HTML" sandbox="" srcDoc={previa.html} className="block h-[420px] w-full border-0 bg-white" />
                ) : (
                  <div className={s.emailTexto}>{previa.texto || <span className={s.vazioTexto}>Escreva a mensagem para ver a prévia.</span>}</div>
                )}
              </div>
            ) : (
              <div className={s.whats}>
                <div className={s.balao}>
                  {previa.texto || <span className="italic opacity-60">Escreva a mensagem para ver a prévia.</span>}
                  <small>09:41</small>
                </div>
              </div>
            )}
            <p className={s.notaPrevia}>
              As variáveis são trocadas pelos dados de um lead fictício — nenhum dado real de cliente aparece aqui.
            </p>
          </aside>
        </div>

        <footer className={s.rodape}>
          <button
            type="button"
            role="switch"
            aria-checked={ativo}
            onClick={() => setAtivo((v) => !v)}
            className={`${s.interruptor} ${ativo ? s.interruptorLigado : ''} focus-ring rounded-md`}
          >
            <span aria-hidden="true" /> Template ativo
          </button>

          {erro ? (
            <span className={s.erro}><AlertCircle size={14} /> {erro}</span>
          ) : pendencia ? (
            <span className={s.pendencia}><AlertCircle size={14} /> {pendencia}</span>
          ) : null}

          <div className={s.rodapeAcoes}>
            {ehEmail && (
              <button type="button" onClick={() => setPreviaAberta(true)} className={`${s.botao} focus-ring`}>
                <Eye size={14} /> Ver prévia
              </button>
            )}
            <button type="button" onClick={onFechar} className={`${s.botao} focus-ring`}>Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando || !!pendencia} className={`${s.botao} ${s.botaoPrimario} focus-ring`}>
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {salvando ? 'Salvando…' : edicao ? 'Salvar alterações' : 'Criar template'}
            </button>
          </div>
        </footer>

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
