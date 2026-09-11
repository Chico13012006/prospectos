'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Check,
  Columns3,
  Copy,
  Eye,
  ExternalLink,
  Inbox,
  List,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  Search,
  Send,
  Target,
  X,
} from 'lucide-react'
import {
  getConversasResposta,
  getConversaDoLead,
  getTemplates,
  getTodosLeads,
  type ConversaResposta,
  type MensagemConversa,
  type StatusConversa,
} from '@/lib/api'
import { corEstagio, labelCanal, labelEstagio, labelProximaAcao } from '@/lib/pipeline-stages'
import { dash } from '@/lib/utils'
import type { Lead, Template } from '@/lib/supabase'
import type { GlobalFilterState } from '@/components/pipeline/GlobalFilters'
import styles from './CentralRespostasView.module.css'

type FiltroStatus = '' | StatusConversa
type Canal = 'email' | 'whatsapp'
const LIMITE_CORPO = 420
const LIMITE_PROSPECCAO = 8

// Templates são texto hoje, mas podem virar HTML. A prévia decide pelo conteúdo.
function pareceHtml(corpo: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(corpo ?? '')
}

const ROTULO_STATUS: Record<StatusConversa, string> = {
  novo: 'Novo',
  pendente: 'Pendente',
  respondido: 'Respondido',
}
const CLASSE_STATUS: Record<StatusConversa, string> = {
  novo: styles.seloNovo,
  pendente: styles.seloPendente,
  respondido: styles.seloRespondido,
}

function iniciais(nome?: string | null): string {
  if (!nome) return '—'
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

function horaCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)
}

function dataHoraLista(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d)
  return `${dia}, ${horaCurta(iso)}`
}

function diaPorExtenso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(d)
}

function chaveDoDia(iso: string): string {
  return iso.slice(0, 10)
}

function SeloCanal({ canal }: { canal: string }) {
  const whats = canal === 'whatsapp'
  return (
    <span className={`${styles.selo} ${whats ? styles.seloWhatsapp : styles.seloEmail}`}>
      {whats ? <MessageCircle size={10} /> : <Mail size={10} />}
      {whats ? 'WhatsApp' : 'E-mail'}
    </span>
  )
}

function Mensagem({ msg }: { msg: MensagemConversa }) {
  const [expandida, setExpandida] = useState(false)
  const longa = msg.corpo.length > LIMITE_CORPO
  const corpo = longa && !expandida ? `${msg.corpo.slice(0, LIMITE_CORPO)}…` : msg.corpo

  return (
    <div className={`${styles.mensagem} ${msg.entrada ? styles.mensagemEntrada : styles.mensagemSaida}`}>
      <div className={styles.mensagemTopo}>
        <span className={styles.mensagemAutor}>{msg.entrada ? 'Lead' : (msg.autor ?? 'Você')}</span>
        <span className={styles.mensagemHora}>{horaCurta(msg.em)}</span>
      </div>
      {msg.assunto ? <span className={styles.mensagemAssunto}>{msg.assunto}</span> : null}
      <p className={styles.mensagemCorpo}>{corpo}</p>
      {longa ? (
        <button type="button" className={styles.verMaisMsg} onClick={() => setExpandida((v) => !v)}>
          {expandida ? 'Mostrar menos' : 'Mostrar mensagem completa'}
        </button>
      ) : null}
    </div>
  )
}

export default function CentralRespostasView({
  filtros,
  onFiltrosChange,
  responsaveis,
  segmentos,
  onAbrirLead,
  reloadKey,
  loading,
  usingSupabase,
  onOpenCadencia,
  onOpenLista,
  onNovoContato,
}: {
  filtros: GlobalFilterState
  onFiltrosChange: (filters: GlobalFilterState) => void
  responsaveis: string[]
  segmentos: string[]
  onAbrirLead: (id: string) => void
  reloadKey: number
  loading: boolean
  usingSupabase: boolean
  onOpenCadencia: () => void
  onOpenLista: () => void
  onNovoContato: () => void
}) {
  const [conversas, setConversas] = useState<ConversaResposta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ativa, setAtiva] = useState<string | null>(null)
  const [status, setStatus] = useState<FiltroStatus>('')
  const [buscaLista, setBuscaLista] = useState('')

  const [fio, setFio] = useState<MensagemConversa[]>([])
  const [fioCarregando, setFioCarregando] = useState(false)
  const [canalAtivo, setCanalAtivo] = useState<'email' | 'whatsapp'>('email')

  const [templates, setTemplates] = useState<Template[]>([])
  const [assunto, setAssunto] = useState('')
  const [texto, setTexto] = useState('')
  const [copiado, setCopiado] = useState(false)
  // Canal do COMPOSER: independente do canal que está sendo lido no fio, mas
  // acompanha a conversa ao trocar de lead.
  const [canalComposer, setCanalComposer] = useState<Canal>('email')
  const [templateId, setTemplateId] = useState('')
  const [previa, setPrevia] = useState(false)

  // Bloco de prospecção (rodapé da coluna esquerda): busca na base existente.
  const [prospBusca, setProspBusca] = useState('')
  const [prospNicho, setProspNicho] = useState('')
  const [prospResultados, setProspResultados] = useState<Lead[] | null>(null)
  const [prospCarregando, setProspCarregando] = useState(false)

  const reqRef = useRef(0)
  const fimDoFioRef = useRef<HTMLDivElement>(null)

  // --- Conversas -----------------------------------------------------------
  const carregarConversas = useCallback(async () => {
    const req = ++reqRef.current
    setCarregando(true)
    try {
      const dados = await getConversasResposta({
        busca: filtros.search.trim(),
        responsavel: filtros.responsavel || undefined,
        segmento: filtros.segmento || undefined,
        canal: filtros.canal || undefined,
      })
      if (req !== reqRef.current) return
      setConversas(dados)
    } finally {
      if (req === reqRef.current) setCarregando(false)
    }
  }, [filtros.search, filtros.responsavel, filtros.segmento, filtros.canal])

  useEffect(() => {
    const t = setTimeout(carregarConversas, 250)
    return () => clearTimeout(t)
  }, [carregarConversas, reloadKey])

  useEffect(() => { getTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])

  const visiveis = useMemo(() => {
    const termo = buscaLista.trim().toLowerCase()
    return conversas.filter((c) => {
      if (status && c.status !== status) return false
      if (!termo) return true
      return (c.lead.contato_nome ?? '').toLowerCase().includes(termo)
        || (c.lead.empresa ?? '').toLowerCase().includes(termo)
        || c.trecho.toLowerCase().includes(termo)
    })
  }, [conversas, status, buscaLista])

  // Seleciona a primeira conversa quando a atual sai da lista filtrada.
  useEffect(() => {
    if (visiveis.length === 0) { setAtiva(null); return }
    if (!ativa || !visiveis.some((c) => c.lead.id === ativa)) setAtiva(visiveis[0].lead.id)
  }, [visiveis, ativa])

  const conversaAtiva = useMemo(
    () => conversas.find((c) => c.lead.id === ativa) ?? null,
    [conversas, ativa],
  )

  // --- Fio da conversa -----------------------------------------------------
  useEffect(() => {
    if (!ativa) { setFio([]); return }
    let cancelado = false
    setFioCarregando(true)
    getConversaDoLead(ativa)
      .then((msgs) => { if (!cancelado) setFio(msgs) })
      .catch(() => { if (!cancelado) setFio([]) })
      .finally(() => { if (!cancelado) setFioCarregando(false) })
    // Trocar de conversa limpa o rascunho — nunca enviar texto no lead errado.
    setAssunto('')
    setTexto('')
    setCopiado(false)
    return () => { cancelado = true }
  }, [ativa])

  const canaisDoFio = useMemo(() => new Set(fio.map((m) => m.canal)), [fio])

  useEffect(() => {
    const inicial: Canal = canaisDoFio.has('email') || canaisDoFio.size === 0 ? 'email' : 'whatsapp'
    setCanalAtivo(inicial)
    setCanalComposer(inicial)
  }, [canaisDoFio])

  const fioDoCanal = useMemo(() => fio.filter((m) => m.canal === canalAtivo), [fio, canalAtivo])

  useEffect(() => {
    fimDoFioRef.current?.scrollIntoView({ block: 'end' })
  }, [fioDoCanal])

  // --- Composer ------------------------------------------------------------
  // Templates do canal escolhido (a tabela `templates` já tem a coluna `canal`).
  const templatesDoCanal = useMemo(
    () => templates.filter((t) => (t.canal ?? 'email') === canalComposer),
    [templates, canalComposer],
  )
  const templateEscolhido = useMemo(
    () => templatesDoCanal.find((t) => t.id === templateId) ?? null,
    [templatesDoCanal, templateId],
  )

  // Trocar de canal zera o template: um template de e-mail não serve no WhatsApp.
  useEffect(() => { setTemplateId(''); setPrevia(false) }, [canalComposer])

  const aplicarTemplate = () => {
    if (!templateEscolhido) return
    if (canalComposer === 'email' && templateEscolhido.assunto) setAssunto(templateEscolhido.assunto)
    setTexto(templateEscolhido.corpo)
  }

  const copiar = async () => {
    const conteudo = canalComposer === 'email' && assunto ? `${assunto}\n\n${texto}` : texto
    try {
      await navigator.clipboard.writeText(conteudo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      setCopiado(false)
    }
  }

  // --- Busca de leads para prospecção --------------------------------------
  // Lê a base que já existe (getTodosLeads). Não é a Base de Leads: é um
  // atalho compacto para achar quem prospectar sem sair da Central.
  const buscarProspeccao = async () => {
    setProspCarregando(true)
    try {
      const { data } = await getTodosLeads(
        { busca: prospBusca.trim() || undefined, segmento: prospNicho || undefined },
        { limit: LIMITE_PROSPECCAO, offset: 0 },
      )
      setProspResultados(data)
    } catch {
      setProspResultados([])
    } finally {
      setProspCarregando(false)
    }
  }

  const contagens = useMemo(() => ({
    todos: conversas.length,
    novo: conversas.filter((c) => c.status === 'novo').length,
    pendente: conversas.filter((c) => c.status === 'pendente').length,
  }), [conversas])

  const setFilters = (patch: Partial<GlobalFilterState>) => onFiltrosChange({ ...filtros, ...patch })
  const temFiltros = Boolean(filtros.search || filtros.responsavel || filtros.segmento || filtros.canal || status || buscaLista)
  const limpar = () => {
    onFiltrosChange({ search: '', responsavel: '', segmento: '', canal: '' })
    setStatus('')
    setBuscaLista('')
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div className={styles.headingBlock}>
          <span className={styles.headingIcon}><BarChart3 size={20} /></span>
          <div>
            <h1>Pipeline de Contato</h1>
            <p>Acompanhe e gerencie o seu processo comercial.</p>
          </div>
        </div>
        <button type="button" className={styles.primaryButton} onClick={onNovoContato}>
          <Plus size={16} /> Novo contato
        </button>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.viewRow}>
          <div className={styles.tabs} aria-label="Visualização da Pipeline">
            <button type="button" onClick={onOpenCadencia} aria-pressed="false">
              <Columns3 size={15} /> Cadência
            </button>
            <button type="button" onClick={onOpenLista} aria-pressed="false">
              <List size={15} /> Lista
            </button>
            <button type="button" className={styles.tabActive} aria-pressed="true">
              <MessagesSquare size={15} /> Central de Respostas
            </button>
          </div>
          <span className={styles.total}>
            <strong>{conversas.length.toLocaleString('pt-BR')}</strong> conversas com resposta
          </span>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={15} aria-hidden="true" />
            <span className={styles.srOnly}>Buscar empresa, contato ou mensagem</span>
            <input
              value={filtros.search}
              onChange={(event) => setFilters({ search: event.target.value })}
              placeholder="Buscar empresa, contato ou e-mail..."
            />
          </label>

          <select value={filtros.segmento} onChange={(e) => setFilters({ segmento: e.target.value })} aria-label="Filtrar por nicho">
            <option value="">Todos os nichos</option>
            {segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filtros.responsavel} onChange={(e) => setFilters({ responsavel: e.target.value })} aria-label="Filtrar por responsável">
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>

          <select value={filtros.canal} onChange={(e) => setFilters({ canal: e.target.value })} aria-label="Filtrar por canal">
            <option value="">Todos os canais</option>
            <option value="email">E-mail</option>
            <option value="whatsapp">WhatsApp</option>
          </select>

          <select value={status} onChange={(e) => setStatus(e.target.value as FiltroStatus)} aria-label="Filtrar por status da resposta">
            <option value="">Todos os status</option>
            <option value="novo">Novo</option>
            <option value="pendente">Pendente</option>
            <option value="respondido">Respondido</option>
          </select>

          {temFiltros ? (
            <button type="button" className={styles.clearButton} onClick={limpar}>
              <X size={14} /> Limpar
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.board}>
        {/* ---------- Esquerda: conversas ---------- */}
        <section className={styles.painel} aria-label="Últimas respostas">
          <header className={styles.painelHeader}>
            <div className={styles.painelTitulo}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Inbox size={15} /> Últimas respostas
              </span>
              <span className={styles.contagem}>{visiveis.length}</span>
            </div>
            <div className={styles.chips}>
              {([
                { id: '', rotulo: 'Todas', n: contagens.todos },
                { id: 'novo', rotulo: 'Novas', n: contagens.novo },
                { id: 'pendente', rotulo: 'Pendentes', n: contagens.pendente },
              ] as const).map((chip) => (
                <button
                  key={chip.id || 'todas'}
                  type="button"
                  className={status === chip.id ? styles.chipAtivo : ''}
                  onClick={() => setStatus(chip.id as FiltroStatus)}
                >
                  {chip.rotulo} <span className={styles.chipContagem}>{chip.n}</span>
                </button>
              ))}
            </div>
            <label className={styles.srOnly} htmlFor="busca-conversas">Buscar nas conversas</label>
            <input
              id="busca-conversas"
              className={styles.campoAssunto}
              style={{ marginTop: '0.6rem', marginBottom: 0 }}
              value={buscaLista}
              onChange={(e) => setBuscaLista(e.target.value)}
              placeholder="Filtrar nesta lista..."
            />
          </header>

          <div className={styles.lista}>
            {loading || carregando ? (
              <div className={styles.vazio}><Loader2 size={16} className={styles.spinner} /> Carregando respostas...</div>
            ) : !usingSupabase ? (
              <div className={styles.vazio}>Não foi possível carregar as respostas.</div>
            ) : visiveis.length === 0 ? (
              <div className={styles.vazio}>
                <Inbox size={22} />
                <span className={styles.vazioTitulo}>Nenhuma resposta</span>
                <span>{temFiltros ? 'Nenhuma conversa bate com os filtros.' : 'Quando um lead responder, a conversa aparece aqui.'}</span>
              </div>
            ) : (
              visiveis.map((c) => (
                <button
                  key={c.lead.id}
                  type="button"
                  className={`${styles.conversa} ${ativa === c.lead.id ? styles.conversaAtiva : ''}`}
                  onClick={() => setAtiva(c.lead.id)}
                >
                  <div className={styles.conversaTopo}>
                    {/* Contato em destaque; a empresa ganha contexto à direita. */}
                    <span className={styles.conversaContato}>{dash(c.lead.contato_nome) || 'Contato não informado'}</span>
                    <span className={styles.conversaQuando}>{dataHoraLista(c.ultimaRespostaEm)}</span>
                  </div>
                  <span className={styles.conversaEmpresa}>{dash(c.lead.empresa)}</span>
                  <span className={styles.conversaTrecho}>{c.trecho || 'Mensagem sem texto.'}</span>
                  <div className={styles.conversaRodape}>
                    <SeloCanal canal={c.canal} />
                    <span className={`${styles.selo} ${CLASSE_STATUS[c.status]}`}>{ROTULO_STATUS[c.status]}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Rodapé fixo da coluna: atalho de prospecção dentro da Central. */}
          <div className={styles.prospeccao}>
            <div className={styles.prospTitulo}>
              <Target size={13} /> Buscar leads para prospecção
            </div>
            <p className={styles.prospApoio}>Encontre novos contatos na base e inicie a conversa.</p>

            <input
              className={styles.prospCampo}
              value={prospBusca}
              onChange={(e) => setProspBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') buscarProspeccao() }}
              placeholder="Empresa ou contato..."
              aria-label="Buscar empresa ou contato para prospecção"
            />

            <div className={styles.prospLinha}>
              <select
                className={styles.prospSelect}
                value={prospNicho}
                onChange={(e) => setProspNicho(e.target.value)}
                aria-label="Nicho para prospecção"
              >
                <option value="">Todos os nichos</option>
                {segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                type="button"
                className={styles.prospBotao}
                onClick={buscarProspeccao}
                disabled={prospCarregando}
              >
                {prospCarregando ? <Loader2 size={12} className={styles.spinner} /> : <Search size={12} />}
                Buscar
              </button>
            </div>

            {prospResultados !== null ? (
              prospResultados.length === 0 ? (
                <p className={styles.prospVazio}>Nenhum lead encontrado.</p>
              ) : (
                <ul className={styles.prospLista}>
                  {prospResultados.map((lead) => (
                    <li key={lead.id}>
                      <button type="button" onClick={() => onAbrirLead(lead.id)}>
                        <span className={styles.prospEmpresa}>{dash(lead.empresa)}</span>
                        <span className={styles.prospMeta}>
                          {[lead.contato_nome, lead.segmento].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </section>

        {/* ---------- Centro: conversa ---------- */}
        <section className={styles.painel} aria-label="Conversa">
          {!conversaAtiva ? (
            <div className={styles.vazio}>
              <MessagesSquare size={26} />
              <span className={styles.vazioTitulo}>Selecione uma conversa</span>
              <span>O histórico completo aparece aqui.</span>
            </div>
          ) : (<>
            <header className={styles.conversaHeader}>
              <span className={styles.avatarConversa}>{iniciais(conversaAtiva.lead.empresa)}</span>
              <div className={styles.conversaHeaderTexto}>
                <h2>{dash(conversaAtiva.lead.empresa)}</h2>
                <p>
                  {dash(conversaAtiva.lead.contato_nome)}
                  {conversaAtiva.lead.cidade ? ` · ${conversaAtiva.lead.cidade}` : ''}
                  {conversaAtiva.lead.estado ? `, ${conversaAtiva.lead.estado}` : ''}
                </p>
              </div>
              {/* Canal sem mensagem fica desabilitado — sem botão decorativo. */}
              <div className={styles.canais}>
                <button
                  type="button"
                  className={canalAtivo === 'email' ? styles.canalAtivo : ''}
                  onClick={() => setCanalAtivo('email')}
                  disabled={!canaisDoFio.has('email')}
                  title={canaisDoFio.has('email') ? 'Ver e-mails' : 'Sem e-mails nesta conversa'}
                >
                  <Mail size={12} /> E-mail
                </button>
                <button
                  type="button"
                  className={canalAtivo === 'whatsapp' ? styles.canalAtivo : ''}
                  onClick={() => setCanalAtivo('whatsapp')}
                  disabled={!canaisDoFio.has('whatsapp')}
                  title={canaisDoFio.has('whatsapp') ? 'Ver WhatsApp' : 'Sem mensagens de WhatsApp nesta conversa'}
                >
                  <MessageCircle size={12} /> WhatsApp
                </button>
              </div>
            </header>

            <div className={styles.fio}>
              {fioCarregando ? (
                <div className={styles.vazio}><Loader2 size={16} className={styles.spinner} /> Carregando conversa...</div>
              ) : fioDoCanal.length === 0 ? (
                <div className={styles.vazio}>
                  <span className={styles.vazioTitulo}>Sem mensagens neste canal</span>
                  <span>Esta conversa não tem histórico de {canalAtivo === 'email' ? 'e-mail' : 'WhatsApp'}.</span>
                </div>
              ) : (
                fioDoCanal.map((msg, i) => {
                  const anterior = fioDoCanal[i - 1]
                  const novoDia = !anterior || chaveDoDia(anterior.em) !== chaveDoDia(msg.em)
                  return (
                    <div key={msg.id} style={{ display: 'contents' }}>
                      {novoDia ? <span className={styles.separadorData}>{diaPorExtenso(msg.em)}</span> : null}
                      <Mensagem msg={msg} />
                    </div>
                  )
                })
              )}
              <div ref={fimDoFioRef} />
            </div>

            <div className={styles.composer}>
              {/* Canal do composer: segmented control, sempre visível. */}
              <div className={styles.composerTopo}>
                <div className={styles.segmented} role="group" aria-label="Canal da resposta">
                  <button
                    type="button"
                    className={canalComposer === 'email' ? styles.segAtivo : ''}
                    onClick={() => setCanalComposer('email')}
                    aria-pressed={canalComposer === 'email'}
                  >
                    <Mail size={12} /> E-mail
                  </button>
                  <button
                    type="button"
                    className={canalComposer === 'whatsapp' ? styles.segAtivo : ''}
                    onClick={() => setCanalComposer('whatsapp')}
                    aria-pressed={canalComposer === 'whatsapp'}
                  >
                    <MessageCircle size={12} /> WhatsApp
                  </button>
                </div>
              </div>

              <div className={styles.templateLinha}>
                <select
                  className={styles.templateSelect}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  aria-label={`Template de ${canalComposer === 'email' ? 'e-mail' : 'WhatsApp'}`}
                  disabled={templatesDoCanal.length === 0}
                >
                  <option value="">
                    {templatesDoCanal.length === 0
                      ? `Nenhum template de ${canalComposer === 'email' ? 'e-mail' : 'WhatsApp'}`
                      : 'Selecione um template...'}
                  </option>
                  {templatesDoCanal.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  onClick={aplicarTemplate}
                  disabled={!templateEscolhido}
                >
                  Aplicar template
                </button>
                {canalComposer === 'email' ? (
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    onClick={() => setPrevia(true)}
                    disabled={!texto.trim()}
                    title="Ver como o e-mail fica renderizado"
                  >
                    <Eye size={13} /> Visualizar
                  </button>
                ) : null}
              </div>

              {/* E-mail tem assunto; WhatsApp é conversacional e não tem. */}
              {canalComposer === 'email' ? (
                <input
                  className={styles.campoAssunto}
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                  placeholder="Assunto"
                  aria-label="Assunto do e-mail"
                />
              ) : null}

              <textarea
                className={styles.campoTexto}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={canalComposer === 'email' ? 'Escreva a resposta...' : 'Mensagem...'}
              />

              <div className={styles.composerAcoes}>
                <span className={styles.aviso}>
                  {canalComposer === 'email'
                    ? <>Envio pela plataforma ainda não ligado — quem dispara e-mail é o motor de cadência. Use <strong>Copiar</strong>.</>
                    : <>Integração de envio do WhatsApp ainda não está ligada nesta versão.</>}
                </span>
                <button type="button" className={styles.botaoSecundario} onClick={copiar} disabled={!texto.trim()}>
                  {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
                </button>
                <button
                  type="button"
                  className={styles.botaoPrincipal}
                  disabled
                  title="Envio pela Central ainda não implementado."
                >
                  <Send size={13} /> Enviar
                </button>
              </div>
            </div>
          </>)}
        </section>

        {/* ---------- Direita: contexto do lead ---------- */}
        <aside className={styles.contexto} aria-label="Contexto do lead">
          {!conversaAtiva ? (
            <div className={styles.vazio}>Nenhuma conversa selecionada.</div>
          ) : (
            <div className={styles.contextoCorpo}>
              {/* Espelho invertido da lista: aqui a EMPRESA é o destaque. */}
              <h2 className={styles.contextoEmpresa}>{dash(conversaAtiva.lead.empresa)}</h2>
              <p className={styles.contextoContato}>
                {dash(conversaAtiva.lead.contato_nome)}
                {conversaAtiva.lead.contato_cargo ? ` · ${conversaAtiva.lead.contato_cargo}` : ''}
              </p>

              {/* Prioridade: estágio/responsável → contato → contexto → volume.
                  Só campos que já existem no lead; nada inventado. */}
              <div className={styles.grupo}>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Estágio</span>
                  <span
                    className={styles.estagioPill}
                    style={{
                      color: corEstagio(conversaAtiva.lead.estagio),
                      backgroundColor: `${corEstagio(conversaAtiva.lead.estagio)}1f`,
                      borderColor: `${corEstagio(conversaAtiva.lead.estagio)}3d`,
                    }}
                  >
                    <span className={styles.estagioDot} style={{ backgroundColor: corEstagio(conversaAtiva.lead.estagio) }} />
                    {labelEstagio(conversaAtiva.lead.estagio)}
                  </span>
                </div>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Responsável</span>
                  <span className={styles.campoValor}>
                    {dash(conversaAtiva.lead.usuarios?.nome ?? conversaAtiva.lead.responsavel_nome)}
                  </span>
                </div>
              </div>

              <div className={styles.grupo}>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Último contato</span>
                  <span className={styles.campoValor}>
                    {conversaAtiva.lead.ultimo_contato ? dataHoraLista(conversaAtiva.lead.ultimo_contato) : '—'}
                  </span>
                </div>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Próxima ação</span>
                  <span className={styles.campoValor}>{labelProximaAcao(conversaAtiva.lead.proxima_acao)}</span>
                </div>
              </div>

              <div className={styles.grupo}>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Nicho</span>
                  <span className={styles.campoValor}>{dash(conversaAtiva.lead.segmento)}</span>
                </div>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Cidade</span>
                  <span className={styles.campoValor}>
                    {[conversaAtiva.lead.cidade, conversaAtiva.lead.estado].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Canal preferencial</span>
                  <span className={styles.campoValor}>{labelCanal(conversaAtiva.lead.canal_preferencial)}</span>
                </div>
              </div>

              <div className={styles.grupo}>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Respostas recebidas</span>
                  <span className={styles.campoValor}>{conversaAtiva.totalRespostas}</span>
                </div>
                <div className={styles.campo}>
                  <span className={styles.campoRotulo}>Mensagens na conversa</span>
                  <span className={styles.campoValor}>{fio.length}</span>
                </div>
              </div>

              {/* Ficha completa = o LeadPanel que já existe, sem duplicar conteúdo. */}
              <button type="button" className={styles.abrirLead} onClick={() => onAbrirLead(conversaAtiva.lead.id)}>
                <ExternalLink size={13} /> Abrir ficha completa
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Prévia do e-mail. HTML vai em iframe com sandbox vazio: sem script,
          sem navegação e sem herdar o CSS da aplicação. */}
      {previa ? (
        <div className={styles.previaFundo} onClick={() => setPrevia(false)}>
          <div className={styles.previaCaixa} onClick={(e) => e.stopPropagation()}>
            <header className={styles.previaHeader}>
              <div>
                <strong>Prévia do e-mail</strong>
                {assunto ? <span className={styles.previaAssunto}>{assunto}</span> : null}
              </div>
              <button type="button" onClick={() => setPrevia(false)} aria-label="Fechar prévia">
                <X size={15} />
              </button>
            </header>
            {pareceHtml(texto) ? (
              <iframe className={styles.previaFrame} sandbox="" title="Prévia do e-mail" srcDoc={texto} />
            ) : (
              <pre className={styles.previaTexto}>{texto}</pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
