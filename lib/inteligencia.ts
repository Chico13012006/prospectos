// Agregações da Inteligência Comercial (sprint item 5). Funções PURAS: recebem
// os leads/interações já carregados (RLS-scoped) + filtros e devolvem os números
// das KPIs, gráficos e tabelas. Ficam fora do componente para serem testáveis e
// para deixar claro o CONTRATO de cada número (nada de mock — onde não há dado,
// devolve zero/vazio de verdade e a UI mostra EmptyState).

// Subconjuntos mínimos das tabelas reais (lib/supabase.ts) que as agregações usam.
export interface LeadIC {
  id: string
  empresa: string
  estagio: string
  score: number
  canal_preferencial: string | null
  segmento: string | null
  estado: string | null
  created_at: string
  // Última atividade (envio/resposta). É a âncora do filtro de período: os leads
  // foram importados em lote com created_at antigo, mas a prospecção é recente —
  // filtrar por created_at zeraria tudo. Cai p/ created_at quando não há contato.
  ultimo_contato: string | null
  responsavel_nome: string | null
  followups_enviados: number | null
}

export interface InteracaoIC {
  tipo: string
  canal: string | null
  created_at: string
  lead_id: string
  template_id?: string | null
}

// Variante de template (A/B testing, item 6). Subconjunto de `templates`.
export interface TemplateVarianteIC {
  id: string
  nome: string
  tipo: string
  nicho: string | null
}

export interface FiltrosIC {
  periodoDias: number | null // null = todo o período
  responsavel: string | null
  canal: string | null
  segmento: string | null
  estado: string | null
}

export const FILTROS_IC_PADRAO: FiltrosIC = {
  periodoDias: 30,
  responsavel: null,
  canal: null,
  segmento: null,
  estado: null,
}

// Vocabulário de estágios deste projeto (mesmos do pipeline). "Respondeu" = já
// deu sinal de vida (o motor move p/ 'interessado' ao detectar resposta; os
// demais são estágios manuais posteriores). "Não prospectado" = ainda no
// reservatório, sem 1º contato.
const ESTAGIOS_RESPONDEU = new Set([
  'interessado', 'respondeu', 'com_closer', 'reuniao_agendada', 'ganho',
])
const ESTAGIOS_NAO_PROSPECTADO = new Set(['novos_leads', 'novo'])

export function respondeu(estagio: string): boolean {
  return ESTAGIOS_RESPONDEU.has(estagio)
}
export function foiProspectado(estagio: string): boolean {
  return !ESTAGIOS_NAO_PROSPECTADO.has(estagio)
}

// Data (YYYY-MM-DD) N dias atrás, à meia-noite. Base do filtro de período.
function limiteInferior(periodoDias: number | null, hoje = new Date()): number | null {
  if (periodoDias == null) return null
  const d = new Date(hoje)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - periodoDias + 1)
  return d.getTime()
}

// Aplica os filtros aos leads. Período filtra pela ÚLTIMA ATIVIDADE do lead
// (ultimo_contato, com fallback p/ created_at) — ver nota em LeadIC.
export function filtrarLeads(leads: LeadIC[], f: FiltrosIC, hoje = new Date()): LeadIC[] {
  const desde = limiteInferior(f.periodoDias, hoje)
  return leads.filter((l) => {
    const marco = new Date(l.ultimo_contato ?? l.created_at).getTime()
    if (desde != null && marco < desde) return false
    if (f.responsavel && (l.responsavel_nome ?? '') !== f.responsavel) return false
    if (f.canal && (l.canal_preferencial ?? '') !== f.canal) return false
    if (f.segmento && (l.segmento ?? '') !== f.segmento) return false
    if (f.estado && (l.estado ?? '') !== f.estado) return false
    return true
  })
}

export interface KpisIC {
  prospectados: number
  responderam: number
  reunioes: number
  // % de conversão = NEGÓCIO FECHADO (estagio='ganho') / prospectados. Conversão
  // é venda ganha, não reunião agendada (definição do Chico). 0 sem prospectados.
  conversao: number
  followups: number
}

export function calcularKpis(leads: LeadIC[]): KpisIC {
  let prospectados = 0
  let responderam = 0
  let reunioes = 0
  let ganhos = 0
  let followups = 0
  for (const l of leads) {
    if (foiProspectado(l.estagio)) prospectados++
    if (respondeu(l.estagio)) responderam++
    if (l.estagio === 'reuniao_agendada') reunioes++
    if (l.estagio === 'ganho') ganhos++
    followups += l.followups_enviados ?? 0
  }
  const conversao = prospectados > 0 ? Math.round((ganhos / prospectados) * 1000) / 10 : 0
  return { prospectados, responderam, reunioes, conversao, followups }
}

// Série temporal por dia: prospecções (abordagem), respostas (resposta) e
// reuniões (reuniao) contadas das INTERAÇÕES reais no período.
export interface PontoEvolucao {
  dia: string // dd/mm
  prospectados: number
  respostas: number
  reunioes: number
}

const TIPO_PARA_SERIE: Record<string, keyof Omit<PontoEvolucao, 'dia'>> = {
  abordagem: 'prospectados',
  resposta: 'respostas',
  reuniao: 'reunioes',
}

export function evolucao(
  interacoes: InteracaoIC[],
  periodoDias: number | null,
  hoje = new Date(),
): PontoEvolucao[] {
  // Janela: período escolhido, ou 30 dias como default visual quando é "tudo".
  const dias = periodoDias ?? 30
  const base = new Date(hoje)
  base.setHours(0, 0, 0, 0)
  const buckets = new Map<string, PontoEvolucao>()
  const chaveDia = (t: number) => {
    const d = new Date(t)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  // Semeia todos os dias da janela (para o gráfico não "pular" dias sem evento).
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    buckets.set(chaveDia(d.getTime()), { dia: chaveDia(d.getTime()), prospectados: 0, respostas: 0, reunioes: 0 })
  }
  const desde = base.getTime() - (dias - 1) * 86400_000
  for (const it of interacoes) {
    const t = new Date(it.created_at).getTime()
    if (t < desde) continue
    const serie = TIPO_PARA_SERIE[it.tipo]
    if (!serie) continue
    const ponto = buckets.get(chaveDia(t))
    if (ponto) ponto[serie]++
  }
  return [...buckets.values()]
}

// Performance por canal preferencial: prospectados, responderam e taxa (%).
export interface LinhaCanal {
  canal: string
  prospectados: number
  responderam: number
  taxa: number
}

export function performancePorCanal(leads: LeadIC[]): LinhaCanal[] {
  const mapa = new Map<string, { prospectados: number; responderam: number }>()
  for (const l of leads) {
    const canal = l.canal_preferencial || 'não definido'
    if (!foiProspectado(l.estagio)) continue
    const linha = mapa.get(canal) ?? { prospectados: 0, responderam: 0 }
    linha.prospectados++
    if (respondeu(l.estagio)) linha.responderam++
    mapa.set(canal, linha)
  }
  return [...mapa.entries()]
    .map(([canal, v]) => ({
      canal,
      prospectados: v.prospectados,
      responderam: v.responderam,
      taxa: v.prospectados > 0 ? Math.round((v.responderam / v.prospectados) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.prospectados - a.prospectados)
}

// Respostas por etapa da cadência: entre os leads que responderam, em qual
// follow-up estavam (0 = respondeu já no 1º contato, N = após o Nº follow-up).
export interface LinhaRespostaFollowup {
  etapa: string
  respostas: number
}

export function respostasPorFollowup(leads: LeadIC[]): LinhaRespostaFollowup[] {
  const contagem = new Map<number, number>()
  let houveResposta = false
  for (const l of leads) {
    if (!respondeu(l.estagio)) continue
    houveResposta = true
    const n = Math.max(0, l.followups_enviados ?? 0)
    contagem.set(n, (contagem.get(n) ?? 0) + 1)
  }
  if (!houveResposta) return []
  const maxN = Math.max(...contagem.keys())
  const linhas: LinhaRespostaFollowup[] = []
  for (let n = 0; n <= maxN; n++) {
    linhas.push({
      etapa: n === 0 ? '1º contato' : `${n}º follow-up`,
      respostas: contagem.get(n) ?? 0,
    })
  }
  return linhas
}

// Tabela "Leads com maior índice de resposta": ordena pelo score (que já embute
// resposta + velocidade, item 2.8). Só entram leads que foram prospectados.
export interface LinhaTopLead {
  id: string
  empresa: string
  responsavel: string
  estagio: string
  score: number
  respondeu: boolean
}

export function topLeadsPorResposta(leads: LeadIC[], limite = 8): LinhaTopLead[] {
  return leads
    .filter((l) => foiProspectado(l.estagio))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limite)
    .map((l) => ({
      id: l.id,
      empresa: l.empresa,
      responsavel: l.responsavel_nome ?? '—',
      estagio: l.estagio,
      score: l.score ?? 0,
      respondeu: respondeu(l.estagio),
    }))
}

// A/B TESTING (item 6): taxa de resposta por VARIANTE de template. Para cada
// template usado em envios (interacoes.template_id), conta os leads DISTINTOS que
// o receberam e quantos responderam. Sem lógica estatística sofisticada — só o
// número real por variante, pra comparar visualmente.
export interface LinhaVariante {
  id: string
  nome: string
  tipo: string
  nicho: string | null
  envios: number // leads distintos que receberam esta variante
  responderam: number
  taxa: number // %
}

export function taxaRespostaPorVariante(
  leads: LeadIC[],
  interacoes: InteracaoIC[],
  templates: TemplateVarianteIC[],
): LinhaVariante[] {
  const respondeuPorLead = new Map<string, boolean>()
  for (const l of leads) respondeuPorLead.set(l.id, respondeu(l.estagio))
  const tplPorId = new Map(templates.map((t) => [t.id, t]))

  // template_id → conjunto de leads distintos que receberam a variante.
  const leadsPorVariante = new Map<string, Set<string>>()
  for (const it of interacoes) {
    if (!it.template_id) continue
    if (it.tipo !== 'abordagem' && !it.tipo.startsWith('follow_up')) continue
    const set = leadsPorVariante.get(it.template_id) ?? new Set<string>()
    set.add(it.lead_id)
    leadsPorVariante.set(it.template_id, set)
  }

  const linhas: LinhaVariante[] = []
  for (const [id, leadsSet] of leadsPorVariante) {
    const tpl = tplPorId.get(id)
    let responderam = 0
    for (const leadId of leadsSet) if (respondeuPorLead.get(leadId)) responderam++
    const envios = leadsSet.size
    linhas.push({
      id,
      nome: tpl?.nome ?? 'Variante removida',
      tipo: tpl?.tipo ?? '—',
      nicho: tpl?.nicho ?? null,
      envios,
      responderam,
      taxa: envios > 0 ? Math.round((responderam / envios) * 1000) / 10 : 0,
    })
  }
  // Agrupa visualmente pela chave (tipo+nicho) e ordena por taxa desc dentro dela.
  return linhas.sort(
    (a, b) =>
      `${a.tipo}${a.nicho ?? ''}`.localeCompare(`${b.tipo}${b.nicho ?? ''}`) ||
      b.taxa - a.taxa ||
      b.envios - a.envios,
  )
}

// Opções dos selects de filtro, derivadas do próprio dado (nunca fixas), para
// que toda opção traga resultado. Segmento/Região saem vazios enquanto os leads
// importados não trouxerem essas colunas — o select fica desabilitado na UI.
export interface OpcoesFiltroIC {
  responsaveis: string[]
  canais: string[]
  segmentos: string[]
  estados: string[]
}

export function opcoesFiltro(leads: LeadIC[]): OpcoesFiltroIC {
  const uniq = (vals: (string | null)[]) =>
    [...new Set(vals.map((v) => (v ?? '').trim()).filter(Boolean))].sort()
  return {
    responsaveis: uniq(leads.map((l) => l.responsavel_nome)),
    canais: uniq(leads.map((l) => l.canal_preferencial)),
    segmentos: uniq(leads.map((l) => l.segmento)),
    estados: uniq(leads.map((l) => l.estado)),
  }
}
