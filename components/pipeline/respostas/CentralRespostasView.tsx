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
  getUsuarios,
  type ConversaResposta,
  type MensagemConversa,
  type StatusConversa,
} from '@/lib/api'
import { corEstagio, labelCanal, labelEstagio, labelProximaAcao } from '@/lib/pipeline-stages'
import { documentoPreviewHtml, montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha'
import { dash } from '@/lib/utils'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { REALTIME_SUBSCRIBE_STATES, type RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import type { Lead, MensagemWhatsapp, Template, Usuario } from '@/lib/supabase'
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

// Separa o texto novo do histórico citado. Heurística simples, só de
// apresentação — o corpo gravado não muda. A citação começa na PRIMEIRA linha
// que bate em um destes sinais:
//   1. linha iniciada por ">"                            (citação clássica)
//   2. "Em … escreveu:" / "On … wrote:"                  (Gmail/Apple/Thunderbird)
//      — a atribuição costuma vir QUEBRADA em 2–3 linhas pelo cliente
//      ("Em seg., 7 de set. …, Fulano <\n email> escreveu:"), então aceita
//      "escreveu:"/"wrote:" no fim desta linha OU de uma das 2 seguintes.
//   3. separadores de reply/forward: "-----Mensagem original-----",
//      "----- Original Message -----", linha de underscores (Outlook),
//      "---------- Forwarded message ----------" / "Mensagem encaminhada".
//   4. cabeçalho de reply do Outlook: "De:" seguido, em até 4 linhas, de
//      "Enviado/Enviada/Sent/Para/To/Assunto/Subject:".
const RE_CITACAO_LINHA = /^>/
const RE_ATRIBUICAO_INICIO = /^(Em|On)\s.{3,}/i
const RE_ATRIBUICAO_FIM = /(escreveu|wrote):\s*$/i
const RE_SEPARADOR = /^(-{3,}\s*(Mensagem original|Original Message|Forwarded message|Mensagem encaminhada)\s*-{0,}|_{8,}|-{10,})\s*$/i
const RE_OUTLOOK_DE = /^(De|From):\s.+/i
const RE_OUTLOOK_CAMPO = /^(Enviad[ao]( em)?|Sent|Para|To|Assunto|Subject):\s/i

function inicioDaCitacao(linhas: string[]): number {
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim()
    if (!l) continue
    if (RE_CITACAO_LINHA.test(l)) return i
    if (RE_SEPARADOR.test(l)) return i
    if (RE_ATRIBUICAO_INICIO.test(l)) {
      const janela = [l, linhas[i + 1]?.trim() ?? '', linhas[i + 2]?.trim() ?? '']
      if (janela.some((x) => RE_ATRIBUICAO_FIM.test(x))) return i
    }
    if (RE_OUTLOOK_DE.test(l)) {
      const proximas = linhas.slice(i + 1, i + 5).map((x) => x.trim())
      if (proximas.some((x) => RE_OUTLOOK_CAMPO.test(x))) return i
    }
  }
  return -1
}

function separarCitacao(corpo: string): { principal: string; citacao: string | null } {
  const linhas = corpo.split('\n')
  const inicio = inicioDaCitacao(linhas)
  // Só vale a pena colapsar se houver texto próprio antes da citação.
  if (inicio <= 0) return { principal: corpo, citacao: null }
  const principal = linhas.slice(0, inicio).join('\n').trim()
  if (!principal) return { principal: corpo, citacao: null }
  const citacao = linhas.slice(inicio).join('\n').trim()
  return { principal, citacao: citacao || null }
}

function dataHoraCompleta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

// "Nome <email>" quando há e-mail; só o nome quando não há.
function Pessoa({ nome, email }: { nome: string; email: string | null }) {
  return (
    <>
      <span className={styles.pessoaNome}>{nome}</span>
      {email ? <span className={styles.pessoaEmail}>&lt;{email}&gt;</span> : null}
    </>
  )
}

// Bloco de E-MAIL: cabeçalho (remetente, selo, data), linhas De/Para, assunto
// em linha própria, corpo em parágrafos e histórico citado recolhido.
//
// Só dados reais: o lead tem nome + e-mail; a nossa ponta é o RESPONSÁVEL do
// lead (nome de `msg.autor`/lead, e-mail de `usuarios`). A caixa remetente da
// organização é config de servidor e não chega ao browser — por isso o e-mail
// mostrado do nosso lado é o do responsável, que assina e recebe cópia.
function MensagemEmail({ msg, lead, responsavel }: {
  msg: MensagemConversa
  lead: Lead
  responsavel: { nome: string; email: string | null }
}) {
  const [expandida, setExpandida] = useState(false)
  const [citacaoAberta, setCitacaoAberta] = useState(false)

  const { principal, citacao } = useMemo(() => separarCitacao(msg.corpo), [msg.corpo])
  const longa = principal.length > LIMITE_CORPO
  const visivel = longa && !expandida ? `${principal.slice(0, LIMITE_CORPO)}…` : principal
  // Parágrafos de verdade: quebra dupla separa <p>; quebra simples vira <br>.
  const paragrafos = useMemo(() => visivel.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), [visivel])

  const contatoLead = { nome: lead.contato_nome?.trim() || 'Contato', email: lead.contato_email?.trim() || null }
  const nosso = { nome: msg.autor?.trim() || responsavel.nome, email: responsavel.email }
  const remetente = msg.entrada ? contatoLead : nosso
  const destinatario = msg.entrada ? nosso : contatoLead

  return (
    <article className={`${styles.email} ${msg.entrada ? styles.emailEntrada : styles.emailSaida}`}>
      <header className={styles.emailCabecalho}>
        <span className={styles.emailAvatar} aria-hidden="true">{iniciais(remetente.nome)}</span>
        <span className={styles.emailRemetente}>{remetente.nome}</span>
        <span className={`${styles.emailDirecao} ${msg.entrada ? styles.emailDirecaoEntrada : styles.emailDirecaoSaida}`}>
          {msg.entrada ? 'Recebido' : 'Enviado'}
        </span>
        <time className={styles.emailQuando} dateTime={msg.em}>{dataHoraCompleta(msg.em)}</time>
      </header>

      <dl className={styles.emailEnvelope}>
        <dt>De</dt>
        <dd><Pessoa nome={remetente.nome} email={remetente.email} /></dd>
        <dt>Para</dt>
        <dd><Pessoa nome={destinatario.nome} email={destinatario.email} /></dd>
      </dl>

      {msg.assunto ? (
        <div className={styles.emailAssunto}>
          <span className={styles.emailAssuntoRotulo}>Assunto</span>
          <h3 className={styles.emailAssuntoValor}>{msg.assunto}</h3>
        </div>
      ) : null}

      <div className={styles.emailCorpo}>
        {paragrafos.length === 0
          ? <p><em className={styles.emailSemTexto}>(sem texto)</em></p>
          : paragrafos.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      {longa ? (
        <button type="button" className={styles.verMaisMsg} onClick={() => setExpandida((v) => !v)}>
          {expandida ? 'Mostrar menos' : 'Mostrar mensagem completa'}
        </button>
      ) : null}

      {citacao ? (
        <div className={styles.citacao}>
          <button type="button" className={styles.citacaoToggle} onClick={() => setCitacaoAberta((v) => !v)} aria-expanded={citacaoAberta}>
            {citacaoAberta ? '▾ Ocultar histórico anterior' : `▸ Mostrar histórico anterior (${citacao.split('\n').length} linhas)`}
          </button>
          {citacaoAberta ? <pre className={styles.citacaoCorpo}>{citacao}</pre> : null}
        </div>
      ) : null}
    </article>
  )
}

// Balão de WHATSAPP — inalterado.
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
  // Usuários da organização (tabela pequena, uma leitura): dá o e-mail real do
  // responsável para as linhas De/Para dos e-mails. Falha = só o nome.
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [assunto, setAssunto] = useState('')
  const [texto, setTexto] = useState('')
  const [copiado, setCopiado] = useState(false)
  // Canal do COMPOSER: independente do canal que está sendo lido no fio, mas
  // acompanha a conversa ao trocar de lead.
  const [canalComposer, setCanalComposer] = useState<Canal>('email')
  const [templateId, setTemplateId] = useState('')
  const [previa, setPrevia] = useState(false)
  // Envio de WhatsApp: só por clique explícito, sem retry. `retornoEnvio`
  // substitui o aviso do rodapé do composer até a próxima tentativa.
  const [enviando, setEnviando] = useState(false)
  const [retornoEnvio, setRetornoEnvio] = useState<{ tipo: 'erro' | 'atencao'; texto: string } | null>(null)

  // Bloco de prospecção (rodapé da coluna esquerda): busca na base existente.
  const [prospBusca, setProspBusca] = useState('')
  const [prospNicho, setProspNicho] = useState('')
  const [prospResultados, setProspResultados] = useState<Lead[] | null>(null)
  const [prospCarregando, setProspCarregando] = useState(false)

  const reqRef = useRef(0)
  const fioReqRef = useRef(0)
  // Lead selecionado no momento — para uma resposta de envio que chega depois
  // de trocar de conversa não mexer no fio nem no rascunho do lead novo.
  const ativaRef = useRef<string | null>(null)
  const fimDoFioRef = useRef<HTMLDivElement>(null)

  // --- Conversas -----------------------------------------------------------
  // `silencioso`: relê sem o spinner (usado pelo tempo real, para a lista não
  // piscar). O contador `reqRef` garante que a resposta mais nova vence.
  const carregarConversas = useCallback(async (opts: { silencioso?: boolean } = {}) => {
    const req = ++reqRef.current
    if (!opts.silencioso) setCarregando(true)
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
    const t = setTimeout(() => carregarConversas(), 250)
    return () => clearTimeout(t)
  }, [carregarConversas, reloadKey])

  // Versão mais recente de carregarConversas (muda com os filtros) para o
  // handler do Realtime, que é criado uma vez só.
  const carregarConversasRef = useRef(carregarConversas)
  useEffect(() => { carregarConversasRef.current = carregarConversas }, [carregarConversas])

  useEffect(() => { getTemplates().then(setTemplates).catch(() => setTemplates([])) }, [])
  useEffect(() => { getUsuarios().then(setUsuarios).catch(() => setUsuarios([])) }, [])

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
  // Contador de requisição: resposta antiga (lead anterior ou recarga anterior)
  // nunca sobrescreve a mais recente. `silencioso` recarrega sem o spinner —
  // usado após enviar, para o histórico não piscar.
  const carregarFio = useCallback(async (leadId: string, opts: { silencioso?: boolean } = {}) => {
    const req = ++fioReqRef.current
    if (!opts.silencioso) setFioCarregando(true)
    try {
      const msgs = await getConversaDoLead(leadId)
      if (req === fioReqRef.current) setFio(msgs)
    } catch {
      if (req === fioReqRef.current) setFio([])
    } finally {
      if (req === fioReqRef.current) setFioCarregando(false)
    }
  }, [])

  useEffect(() => {
    ativaRef.current = ativa
    // Trocar de conversa limpa o rascunho — nunca enviar texto no lead errado.
    setAssunto('')
    setTexto('')
    setCopiado(false)
    setRetornoEnvio(null)
    if (!ativa) { fioReqRef.current++; setFio([]); return }
    carregarFio(ativa)
  }, [ativa, carregarFio])

  // --- Tempo real (WhatsApp) -----------------------------------------------
  // INSERT em `whatsapp_mensagens` → releitura das fontes oficiais
  // (getConversasResposta / getConversaDoLead). Nada de polling: o canal fica
  // aberto e só reage a evento. Nenhuma mensagem é montada no cliente a partir
  // do payload — ele só diz "houve novidade" e para qual lead.
  //
  // Isolamento: o Realtime avalia a policy de SELECT da tabela
  // (organizacao_id = current_org_id()) com o JWT da sessão que o supabase-js
  // propaga ao socket. Evento de outra organização, ou de mensagem ainda sem
  // vínculo (organizacao_id NULL), nunca chega aqui. Sem sessão, nada chega.
  //
  // Pré-requisito de banco: a tabela precisa estar na publicação
  // `supabase_realtime`; sem isso o canal assina, mas não recebe eventos.
  useEffect(() => {
    // Singleton do @supabase/ssr: a MESMA instância (e sessão) que lib/api usa.
    const supabase = createSupabaseBrowserClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const pendentes = { leads: new Set<string>(), fioAberto: false }
    let jaInscrito = false

    // Coalesce: rajada de eventos vira UMA releitura da lista (+ uma do fio,
    // se o lead aberto está entre os afetados). Idempotente por construção: o
    // estado é SUBSTITUÍDO pelo que a fonte devolve, nunca acrescido — releitura
    // manual e por evento no mesmo instante produzem o mesmo resultado, e os
    // contadores de requisição descartam a resposta mais antiga.
    const agendarReleitura = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const aberto = ativaRef.current
        const relerFio = !!aberto && (pendentes.fioAberto || pendentes.leads.has(aberto))
        pendentes.leads.clear()
        pendentes.fioAberto = false
        carregarConversasRef.current({ silencioso: true })
        if (aberto && relerFio) carregarFio(aberto, { silencioso: true })
      }, 300)
    }

    const canal = supabase
      .channel('central-respostas:whatsapp_mensagens')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_mensagens' },
        (payload: RealtimePostgresInsertPayload<Pick<MensagemWhatsapp, 'id' | 'lead_id' | 'direcao'>>) => {
          // Sem vínculo com lead a mensagem não aparece na Central — nada a reler.
          const leadId = payload.new?.lead_id
          if (!leadId) return
          pendentes.leads.add(leadId)
          agendarReleitura()
        },
      )
      .subscribe((status, err) => {
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          // Re-inscrição após queda de conexão: eventos do intervalo se perderam,
          // então uma releitura de recuperação (lista + fio aberto). Na primeira
          // inscrição não — a carga inicial já está a caminho.
          if (jaInscrito) { pendentes.fioAberto = true; agendarReleitura() }
          jaInscrito = true
        } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
          // Sem toast: a Central continua funcionando por leitura normal.
          console.warn('[central-respostas] realtime whatsapp_mensagens:', status, err?.message ?? '')
        }
      })

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(canal)
    }
  }, [carregarFio])

  const canaisDoFio = useMemo(() => new Set(fio.map((m) => m.canal)), [fio])

  // Canal inicial (leitura e composer) = canal da última resposta recebida.
  // Keyed no LEAD, não no fio: recarregar o fio (ex.: depois de enviar) não
  // pode desfazer o canal que o usuário escolheu à mão.
  const canalUltimaResposta = conversaAtiva?.canal
  useEffect(() => {
    if (!ativa) return
    const inicial: Canal = canalUltimaResposta === 'whatsapp' ? 'whatsapp' : 'email'
    setCanalAtivo(inicial)
    setCanalComposer(inicial)
  }, [ativa, canalUltimaResposta])

  const fioDoCanal = useMemo(() => fio.filter((m) => m.canal === canalAtivo), [fio, canalAtivo])

  // Responsável do lead ativo, com e-mail real quando ele existe em `usuarios`.
  // Lead legado sem responsavel_id cai no nome em texto, sem e-mail.
  const responsavelDaConversa = useMemo(() => {
    const lead = conversaAtiva?.lead
    const usuario = lead?.responsavel_id ? usuarios.find((u) => u.id === lead.responsavel_id) : undefined
    return {
      nome: usuario?.nome?.trim() || lead?.usuarios?.nome?.trim() || lead?.responsavel_nome?.trim() || 'Você',
      email: usuario?.email?.trim() || null,
    }
  }, [conversaAtiva, usuarios])

  // Assunto de RESPOSTA: ao abrir uma conversa (ou depois de enviar, quando o
  // composer é limpo), sugere "Re: <último assunto do fio>". Só preenche campo
  // vazio — nunca sobrescreve o que o usuário digitou. Fica visível e editável.
  useEffect(() => {
    if (assunto.trim()) return
    const ultimoEmail = [...fio].reverse().find((m) => m.canal === 'email' && m.assunto?.trim())
    if (!ultimoEmail?.assunto) return
    const base = ultimoEmail.assunto.replace(/^\s*(re|res|fwd?|enc)\s*:\s*/i, '').trim()
    setAssunto(`Re: ${base}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fio])

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
  // E limpa o retorno do envio — um erro de WhatsApp não pertence ao e-mail.
  useEffect(() => { setTemplateId(''); setPrevia(false); setRetornoEnvio(null) }, [canalComposer])

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

  // Envio de WhatsApp pela rota já existente (POST /api/whatsapp/enviar). A
  // organização vem da SESSÃO no servidor; daqui vai só { leadId, texto }.
  // Dispara SÓ no clique. Sem retry: erro fica na tela com o texto preservado.
  // Em sucesso não há mensagem otimista — o fio é recarregado e a outbound
  // aparece vinda de `whatsapp_mensagens`.
  const podeEnviarWhatsapp = canalComposer === 'whatsapp' && !!conversaAtiva && !!texto.trim() && !enviando
  const enviarWhatsapp = async () => {
    if (!podeEnviarWhatsapp || !conversaAtiva) return
    const leadId = conversaAtiva.lead.id
    setEnviando(true)
    setRetornoEnvio(null)
    try {
      const res = await fetch('/api/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, texto }),
      })
      const corpo = (await res.json().catch(() => ({}))) as {
        erro?: string; codigo?: string; simulado?: boolean
      }
      // Usuário trocou de conversa enquanto enviava: não mexer no lead novo.
      if (ativaRef.current !== leadId) return

      if (!res.ok) {
        setRetornoEnvio({
          tipo: 'erro',
          texto: corpo.codigo === 'fora_da_janela'
            ? 'Fora da janela de 24h: o WhatsApp só aceita texto livre até 24h após a última mensagem recebida do lead. Será necessário usar um template aprovado do WhatsApp.'
            : (corpo.erro ?? `Não foi possível enviar (erro ${res.status}).`),
        })
        return
      }
      if (corpo.simulado) {
        // WHATSAPP_MODO_ENSAIO: nada foi enviado nem gravado. Mantém o texto e
        // diz isso — sem fingir sucesso.
        setRetornoEnvio({ tipo: 'atencao', texto: 'Modo ensaio do WhatsApp: envio simulado — nada foi enviado nem gravado.' })
        return
      }
      setTexto('')
      await carregarFio(leadId, { silencioso: true })
    } catch (e) {
      if (ativaRef.current !== leadId) return
      setRetornoEnvio({ tipo: 'erro', texto: `Falha de rede ao enviar: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setEnviando(false)
    }
  }

  // Envio de E-MAIL pela rota /api/email/enviar, que usa o motor de e-mail já
  // existente (GmailProvider + registrarInteracao). Mesmo contrato do WhatsApp:
  // organização vem da sessão; daqui vai { leadId, assunto, texto }. Sem retry;
  // em erro o texto fica. Em sucesso o fio é recarregado e o e-mail aparece
  // vindo de `interacoes` (nota/email), a fonte que a Central já lê.
  const leadTemEmail = !!conversaAtiva?.lead.contato_email?.trim()
  const podeEnviarEmail = canalComposer === 'email'
    && !!conversaAtiva && leadTemEmail
    && !!assunto.trim() && !!texto.trim() && !enviando
  const enviarEmail = async () => {
    if (!podeEnviarEmail || !conversaAtiva) return
    const leadId = conversaAtiva.lead.id
    setEnviando(true)
    setRetornoEnvio(null)
    try {
      const res = await fetch('/api/email/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, assunto, texto }),
      })
      const corpo = (await res.json().catch(() => ({}))) as {
        erro?: string; codigo?: string; simulado?: boolean; interacaoRegistrada?: boolean
      }
      if (ativaRef.current !== leadId) return

      if (!res.ok) {
        setRetornoEnvio({ tipo: 'erro', texto: corpo.erro ?? `Não foi possível enviar (erro ${res.status}).` })
        return
      }
      if (corpo.simulado) {
        // MODO_ENSAIO global do motor: nada saiu nem foi registrado.
        setRetornoEnvio({ tipo: 'atencao', texto: 'Motor em MODO_ENSAIO: e-mail simulado — nada foi enviado nem registrado.' })
        return
      }
      setAssunto('')
      setTexto('')
      setTemplateId('')
      if (corpo.interacaoRegistrada === false) {
        setRetornoEnvio({ tipo: 'atencao', texto: 'E-mail enviado, mas o registro no histórico falhou. Não reenvie.' })
      }
      await carregarFio(leadId, { silencioso: true })
    } catch (e) {
      if (ativaRef.current !== leadId) return
      setRetornoEnvio({ tipo: 'erro', texto: `Falha de rede ao enviar: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setEnviando(false)
    }
  }

  // Prévia FIEL ao que sai: passa pelo mesmo montarEmailCampanhaHtml do envio
  // (HTML sanitizado ou texto escapado + assinatura) e pelo documentoPreviewHtml
  // (CSP sem script). Só falta o nome do serviço, que é config da org.
  const htmlPrevia = useMemo(() => {
    if (!texto.trim()) return ''
    const responsavelNome = conversaAtiva?.lead.usuarios?.nome ?? conversaAtiva?.lead.responsavel_nome ?? null
    const miolo = pareceHtml(texto)
      ? montarEmailCampanhaHtml('', { responsavelNome }, texto)
      : montarEmailCampanhaHtml(texto, { responsavelNome })
    return documentoPreviewHtml(miolo)
  }, [texto, conversaAtiva])

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

            <div className={`${styles.fio} ${canalAtivo === 'email' ? styles.fioEmail : ''}`}>
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
                      {msg.canal === 'email'
                        ? <MensagemEmail msg={msg} lead={conversaAtiva.lead} responsavel={responsavelDaConversa} />
                        : <Mensagem msg={msg} />}
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

                {/* Template na MESMA linha do canal: composer mais baixo. */}
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
              </div>

              {/* E-mail tem assunto; WhatsApp é conversacional e não tem. */}
              {canalComposer === 'email' ? (
                <label className={styles.assuntoLinha}>
                  <span className={styles.assuntoRotulo}>Assunto</span>
                  <input
                    className={styles.assuntoCampo}
                    value={assunto}
                    onChange={(e) => setAssunto(e.target.value)}
                    placeholder="Assunto do e-mail"
                    aria-label="Assunto do e-mail"
                  />
                </label>
              ) : null}

              <textarea
                className={`${styles.campoTexto} ${canalComposer === 'email' ? styles.campoTextoEmail : ''}`}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={canalComposer === 'email' ? 'Escreva sua mensagem aqui...' : 'Mensagem...'}
              />

              <div className={styles.composerAcoes}>
                <span
                  className={`${styles.aviso} ${retornoEnvio?.tipo === 'erro' ? styles.avisoErro : retornoEnvio?.tipo === 'atencao' ? styles.avisoAtencao : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  {retornoEnvio
                    ? retornoEnvio.texto
                    : canalComposer === 'email'
                      ? (leadTemEmail
                          ? <>O e-mail é enviado pela plataforma, com a assinatura do responsável, e registrado no histórico da conversa.</>
                          : <>Este lead não tem e-mail cadastrado.</>)
                      : <>Texto livre só dentro da janela de 24h após a última mensagem recebida do lead.</>}
                </span>
                <button type="button" className={styles.botaoSecundario} onClick={copiar} disabled={!texto.trim()}>
                  {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
                </button>
                {canalComposer === 'whatsapp' ? (
                  <button
                    type="button"
                    className={styles.botaoPrincipal}
                    onClick={enviarWhatsapp}
                    disabled={!podeEnviarWhatsapp}
                    title={enviando ? 'Enviando...' : !texto.trim() ? 'Escreva a mensagem para enviar.' : 'Enviar pelo WhatsApp'}
                  >
                    {enviando
                      ? <><Loader2 size={13} className={styles.spinner} /> Enviando...</>
                      : <><Send size={13} /> Enviar</>}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.botaoPrincipal}
                    onClick={enviarEmail}
                    disabled={!podeEnviarEmail}
                    title={
                      enviando ? 'Enviando...'
                      : !leadTemEmail ? 'O lead não tem e-mail cadastrado.'
                      : !assunto.trim() ? 'Informe o assunto.'
                      : !texto.trim() ? 'Escreva a mensagem para enviar.'
                      : 'Enviar e-mail'
                    }
                  >
                    {enviando
                      ? <><Loader2 size={13} className={styles.spinner} /> Enviando...</>
                      : <><Send size={13} /> Enviar</>}
                  </button>
                )}
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

      {/* Prévia do e-mail: o MESMO HTML que o envio monta (montarEmailCampanhaHtml
          + documentoPreviewHtml, com CSP sem script), num iframe com sandbox
          vazio — sem script, sem navegação, sem herdar o CSS da aplicação. */}
      {previa ? (
        <div className={styles.previaFundo} onClick={() => setPrevia(false)}>
          <div className={styles.previaCaixa} onClick={(e) => e.stopPropagation()}>
            <header className={styles.previaHeader}>
              <div>
                <strong>Prévia do e-mail</strong>
                <span className={styles.previaSub}>
                  {templateEscolhido ? <>Template aplicado: <b>{templateEscolhido.nome}</b> · </> : null}
                  {pareceHtml(texto) ? 'Corpo em HTML' : 'Corpo em texto'} · assinatura do responsável incluída
                </span>
              </div>
              <button type="button" onClick={() => setPrevia(false)} aria-label="Fechar prévia">
                <X size={15} />
              </button>
            </header>
            {/* Cabeçalho no estilo de cliente de e-mail: só dados reais. */}
            <dl className={styles.previaEnvelope}>
              <dt>Para</dt>
              <dd>
                {conversaAtiva?.lead.contato_nome?.trim() || 'Contato'}
                {conversaAtiva?.lead.contato_email ? <span className={styles.pessoaEmail}> &lt;{conversaAtiva.lead.contato_email}&gt;</span> : null}
              </dd>
              <dt>Assunto</dt>
              <dd className={styles.previaEnvelopeAssunto}>{assunto.trim() || <em>(sem assunto)</em>}</dd>
            </dl>
            <iframe className={styles.previaFrame} sandbox="" title="Prévia do e-mail" srcDoc={htmlPrevia} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
