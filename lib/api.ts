import type { Lead, Interacao, Usuario, Template, MensagemWhatsapp } from './supabase'
import { apenasTemplatesAutorais } from './campanhas/workflowsInternos'
import { normalizarNicho } from './nichos/normalizar'
import { createSupabaseBrowserClient } from './supabase-browser'
import { ESTAGIOS_RESERVATORIO, estagiosDoStatus } from './pipeline-stages'

// Camada de dados do browser. ANTES: usava o client anon "cru" de lib/supabase.ts
// (createClient com anonKey, sessão em localStorage), que NÃO compartilhava o
// cookie de sessão do login (feito via @supabase/ssr em lib/supabase-browser.ts)
// — na prática, requisições anônimas. Isso é pré-requisito da RLS multi-tenant:
// as policies dependem de auth.uid(), que só resolve se o client carregar a
// sessão do usuário logado. Trocamos para o client baseado em cookie (SSR), que
// é o MESMO usado no login, então auth.uid() passa a existir nas queries daqui.
// Todos os consumidores de lib/api.ts são 'use client', então o client de
// browser é seguro (as queries rodam no browser, em handlers/useEffect).
const supabase = createSupabaseBrowserClient()

// --- LEADS ---

export async function getLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select(`
      *,
      usuarios:responsavel_id (
        id,
        nome
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Erro ao buscar leads:', error)
    return []
  }
  return data || []
}

// Filtro "Responsável": o dropdown lista `usuarios.nome` (ex.: "Francisco"),
// mas os leads guardam a atribuição de DUAS formas: `responsavel_id` (FK para
// usuarios — fluxo normal da plataforma) e `responsavel_nome` (texto legado do
// import HubSpot via scripts/popular-responsavel.ts, com o nome COMPLETO do
// CSV, ex.: "Francisco Rufino"). Por isso o filtro casa por id OU por PREFIXO
// do nome — `eq` nunca acharia "Francisco Rufino" a partir de "Francisco".
// O id é resolvido com uma query leve em `usuarios`, cacheada no módulo
// (tabela pequena e estável), para não custar uma query extra por coluna do
// Kanban. Trade-off documentado: o prefixo pode sobrepor nomes ("Ana" casaria
// "Ana Paula"), aceitável com a equipe atual e preferível a esconder leads.
const responsavelIdCache = new Map<string, string | null>()
async function resolverResponsavelId(nome: string): Promise<string | null> {
  const cached = responsavelIdCache.get(nome)
  if (cached !== undefined) return cached
  const { data, error } = await supabase.from('usuarios').select('id').eq('nome', nome).limit(1)
  const id = !error && data && data.length > 0 ? (data[0].id as string) : null
  responsavelIdCache.set(nome, id)
  return id
}

async function filtroResponsavelOr(nome: string): Promise<string> {
  const limpo = nome.replace(/[%,()"]/g, ' ').trim()
  const porNome = `responsavel_nome.ilike.${limpo}%`
  const id = await resolverResponsavelId(nome)
  return id ? `responsavel_id.eq.${id},${porNome}` : porNome
}

export interface PipelineColFiltros {
  responsavel?: string
  segmento?: string
  canal?: string
  busca?: string
  desde?: string | null
  // Visão Cadência: nº de follow-ups enviados — exato (1,2,3) ou cap ({ gte: 4 }).
  followups?: number | { gte: number }
}

// CORAÇÃO DA ESCALA: cada coluna do board usa esta query — NUNCA busca tudo.
// Página com limite/offset (range), filtros server-side e `count: 'exact'`, que
// devolve o TOTAL REAL do(s) estágio(s) mesmo lendo só uma página (p/ o contador
// "Em Prospecção — 1.240"). `ordenarPor`: 'created_at' p/ o reservatório (mais
// novos primeiro), 'ultimo_contato' p/ as colunas de tempo real.
export async function getLeadsPorEstagioPaginado(
  estagios: string[],
  filtros: PipelineColFiltros = {},
  opts: { limit?: number; offset?: number; ordenarPor?: 'created_at' | 'ultimo_contato' } = {},
): Promise<{ data: Lead[]; total: number }> {
  const { limit = 50, offset = 0, ordenarPor = 'ultimo_contato' } = opts
  const { responsavel, segmento, canal, busca, desde, followups } = filtros
  let q = supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })
    .in('estagio', estagios)
  if (typeof followups === 'number') q = q.eq('followups_enviados', followups)
  else if (followups) q = q.gte('followups_enviados', followups.gte)
  if (desde) q = q.gte('created_at', desde)
  if (responsavel) q = q.or(await filtroResponsavelOr(responsavel))
  if (segmento) q = q.eq('segmento', segmento)
  if (canal) q = q.eq('canal_preferencial', canal)
  if (busca && busca.trim()) {
    const t = busca.trim().replace(/[%,()]/g, ' ')
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  if (ordenarPor === 'created_at') {
    q = q.order('created_at', { ascending: false })
  } else {
    q = q.order('ultimo_contato', { ascending: false, nullsFirst: false })
  }
  // Desempate por id: sem ele, linhas empatadas (mesma data / null) podem mudar
  // de ordem entre queries e o scroll infinito duplica/pula leads entre páginas.
  q = q.order('id', { ascending: true })
  const { data, error, count } = await q.range(offset, offset + limit - 1)
  if (error) {
    console.error('getLeadsPorEstagioPaginado:', error)
    return { data: [], total: 0 }
  }
  return { data: (data ?? []) as Lead[], total: count ?? 0 }
}

// --- VISÃO CADÊNCIA -------------------------------------------------------
// A Cadência NÃO deriva a etapa de `leads.estagio` nem de `leads.followups_enviados`.
// Motivo: só o motor legado (lib/engine) mantém esses dois campos. Organizações
// que rodam Campanhas/Workflows enviam por AmbienteSupabase.enviarEmailTemplate,
// que grava a interação como tipo='nota' e NÃO toca em estagio/followups_enviados
// — nessas orgs o board inteiro aparecia zerado mesmo com o 1º contato enviado.
//
// Fontes autoritativas desta visão:
//   inscrição → `workflow_execucoes` (lead inscrito em workflow/campanha)
//   nº envios → `interacoes` (canal='email', origem_acao='ia',
//                tipo IN ('abordagem','follow_up','nota'))
// `estagio` só decide "Respondeu", que tem PRECEDÊNCIA sobre a contagem de envios.
// Lead sem execução em workflow não entra na Cadência.
//
// Escala: a classificação é feita em memória, sobre os leads inscritos. É o
// suficiente para o volume atual e mantém a correção óbvia. O caminho de escala
// é um contador denormalizado mantido pelos DOIS motores (hoje inexistente) —
// decisão adiada de propósito, não esquecida.
export const TIPOS_INTERACAO_ENVIO = ['abordagem', 'follow_up', 'nota']
const ESTAGIOS_RESPONDEU_CADENCIA = ['interessado', 'respondeu', 'com_closer']
const PAGINA_SUPABASE = 1000
const LOTE_IDS = 150

export type EtapaCadencia =
  | 'a_iniciar' | 'contato1' | 'followup1' | 'followup2' | 'followup3' | 'followup4' | 'respondeu'

export interface LeadCadencia extends Lead {
  etapa: EtapaCadencia
  envios: number
}

// nº de envios → etapa. 0 = inscrito e ainda sem envio: classificado como
// 'a_iniciar', que HOJE não tem coluna no board (fica pronto para quando
// decidirmos exibir "A iniciar", sem virar lead invisível por acidente).
export function etapaPorEnvios(envios: number): EtapaCadencia {
  if (envios <= 0) return 'a_iniciar'
  if (envios === 1) return 'contato1'
  if (envios === 2) return 'followup1'
  if (envios === 3) return 'followup2'
  if (envios === 4) return 'followup3'
  return 'followup4'
}

// Leads com ao menos uma execução de workflow (= inscritos). Isolamento por
// organização vem da RLS (client de browser com a sessão do usuário).
async function idsInscritosEmWorkflow(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let offset = 0; ; offset += PAGINA_SUPABASE) {
    const { data, error } = await supabase
      .from('workflow_execucoes')
      .select('lead_id')
      .not('lead_id', 'is', null)
      .range(offset, offset + PAGINA_SUPABASE - 1)
    if (error) {
      console.error('cadencia/inscritos:', error)
      break
    }
    for (const row of data ?? []) if (row.lead_id) ids.add(row.lead_id as string)
    if (!data || data.length < PAGINA_SUPABASE) break
  }
  return ids
}

// Contagem de e-mails de saída por lead. Cobre os DOIS motores: o legado grava
// tipo='abordagem'/'follow_up', o de workflows grava tipo='nota'. `canal='email'`
// é o que separa envio de nota de sistema (tarefa, bounce, log).
async function enviosPorLead(): Promise<Map<string, number>> {
  const contagem = new Map<string, number>()
  for (let offset = 0; ; offset += PAGINA_SUPABASE) {
    const { data, error } = await supabase
      .from('interacoes')
      .select('lead_id')
      .eq('canal', 'email')
      .eq('origem_acao', 'ia')
      .in('tipo', TIPOS_INTERACAO_ENVIO)
      .range(offset, offset + PAGINA_SUPABASE - 1)
    if (error) {
      console.error('cadencia/envios:', error)
      break
    }
    for (const row of data ?? []) {
      const id = row.lead_id as string | null
      if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1)
    }
    if (!data || data.length < PAGINA_SUPABASE) break
  }
  return contagem
}

export async function getLeadsCadencia(filtros: PipelineColFiltros = {}): Promise<LeadCadencia[]> {
  const inscritos = await idsInscritosEmWorkflow()
  if (inscritos.size === 0) return []
  const envios = await enviosPorLead()

  const { responsavel, segmento, canal, busca } = filtros
  const orResponsavel = responsavel ? await filtroResponsavelOr(responsavel) : null
  const ids = [...inscritos]
  const leads: Lead[] = []
  // Busca em lotes de ids: restringe aos inscritos sem montar um `in` gigante
  // na URL — e sem varrer a base inteira.
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    let q = supabase
      .from('leads')
      .select('*, usuarios:responsavel_id (id, nome)')
      .in('id', ids.slice(i, i + LOTE_IDS))
    if (orResponsavel) q = q.or(orResponsavel)
    if (segmento) q = q.eq('segmento', segmento)
    if (canal) q = q.eq('canal_preferencial', canal)
    if (busca && busca.trim()) {
      const t = busca.trim().replace(/[%,()]/g, ' ')
      q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
    }
    const { data, error } = await q
    if (error) {
      console.error('getLeadsCadencia:', error)
      return []
    }
    leads.push(...((data ?? []) as Lead[]))
  }

  // Mesma ordenação das colunas anteriores: último contato desc (nulos por
  // último) e `id` como desempate estável.
  const quando = (l: Lead) => (l.ultimo_contato ? new Date(l.ultimo_contato).getTime() : null)
  leads.sort((a, b) => {
    const ta = quando(a)
    const tb = quando(b)
    if (ta === null && tb !== null) return 1
    if (tb === null && ta !== null) return -1
    if (ta !== null && tb !== null && ta !== tb) return tb - ta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  return leads.map((lead) => {
    const n = envios.get(lead.id) ?? 0
    return {
      ...lead,
      envios: n,
      // Respondeu vence a contagem de envios.
      etapa: ESTAGIOS_RESPONDEU_CADENCIA.includes(lead.estagio ?? '') ? 'respondeu' : etapaPorEnvios(n),
    }
  })
}

// RESERVATÓRIO "Novos Leads": caso particular do paginado, com filtro de data
// (default últimos 30 dias) e ordenação por data de entrada.
export async function getNovosLeads(opts: {
  desde?: string | null
  busca?: string
  responsavel?: string
  segmento?: string
  canal?: string
  limit?: number
  offset?: number
}): Promise<{ data: Lead[]; total: number }> {
  const { desde, busca, responsavel, segmento, canal, limit = 50, offset = 0 } = opts
  return getLeadsPorEstagioPaginado(
    ESTAGIOS_RESERVATORIO,
    { desde, busca, responsavel, segmento, canal },
    { limit, offset, ordenarPor: 'created_at' },
  )
}

// Opções dos filtros globais (responsável / nicho / canal). Não derivamos mais
// dos leads carregados (não carregamos todos). Responsáveis vêm de `usuarios`
// (tabela pequena); canais são um enum fixo; segmentos saem de um distinct leve.
const CANAIS_FIXOS = ['email', 'whatsapp', 'linkedin', 'telefone']
export async function getPipelineFiltrosOpcoes(): Promise<{
  responsaveis: string[]
  segmentos: string[]
  canais: string[]
}> {
  // Responsáveis derivam do que os LEADS realmente carregam (responsavel_nome),
  // não de usuarios.nome. O filtro casa por responsavel_nome (ilike prefixo) /
  // responsavel_id — e hoje responsavel_id é null em 100% dos leads (import
  // HubSpot só preencheu o nome). Listar usuarios.nome trazia opções que NÃO
  // batem com os nomes dos leads: ex. "Francisco Rufs" (usuario admin) nunca é
  // prefixo de "Francisco Rufino" (nome no lead) → o filtro voltava 0 sempre.
  // Derivar do próprio dado garante que toda opção do dropdown traz resultado.
  // Ver [[leads-responsavel-data-model]]. Uma única varredura de coluna serve
  // aos dois selects (responsáveis + nichos).
  const { data, error } = await supabase.from('leads').select('responsavel_nome, segmento')
  if (error) throw error
  const responsaveis = [...new Set((data ?? []).map(l => l.responsavel_nome).filter(Boolean))].sort() as string[]
  const segmentos = [...new Set((data ?? []).map(l => l.segmento).filter(Boolean))].sort() as string[]
  return { responsaveis, segmentos, canais: CANAIS_FIXOS }
}

// BASE DE LEADS: banco geral de TODOS os leads (qualquer estado). Paginado no
// servidor (range), COUNT exato, busca e filtros server-side. NUNCA busca tudo.
// Campos aceitos para ordenação da Tabela operacional (evita passar coluna
// arbitrária direto pro Supabase a partir do clique do usuário).
export type LeadOrdenavel =
  | 'empresa' | 'segmento' | 'canal_preferencial' | 'estagio'
  | 'ultimo_contato' | 'created_at' | 'responsavel_nome' | 'contato_cargo'
  | 'score'

export interface BaseLeadsFiltros {
  busca?: string
  responsavel?: string
  segmento?: string
  canal?: string             // canal_preferencial exato
  estagio?: string           // status comercial exato
  estagios?: string[]        // grupo de estágios (chips rápidos — ex.: colunas do Kanban)
  followups?: number | { gte: number }
  cidade?: string
  estado?: string
  cadastroDe?: string | null   // created_at >=
  cadastroAte?: string | null  // created_at <=
  interacaoDe?: string | null  // ultimo_contato >=
  interacaoAte?: string | null // ultimo_contato <=
  atalho?: 'responderam' | 'sem_resposta' | 'arquivados' | 'reativacao'
  ordenarPor?: { campo: LeadOrdenavel; asc: boolean }
}

export async function getTodosLeads(
  filtros: BaseLeadsFiltros = {},
  opts: { limit?: number; offset?: number } = {},
): Promise<{ data: Lead[]; total: number }> {
  const { limit = 50, offset = 0 } = opts
  const f = filtros
  let q = supabase.from('leads').select('*, usuarios:responsavel_id (id, nome)', { count: 'exact' })

  if (f.busca && f.busca.trim()) {
    const t = f.busca.trim().replace(/[%,()]/g, ' ')
    q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
  }
  if (f.responsavel) q = q.or(await filtroResponsavelOr(f.responsavel))
  if (f.segmento) q = q.eq('segmento', f.segmento)
  if (f.canal) q = q.eq('canal_preferencial', f.canal)
  if (f.estagio) q = q.in('estagio', estagiosDoStatus(f.estagio))
  else if (f.estagios && f.estagios.length) q = q.in('estagio', f.estagios)
  if (typeof f.followups === 'number') q = q.eq('followups_enviados', f.followups)
  else if (f.followups) q = q.gte('followups_enviados', f.followups.gte)
  if (f.cidade && f.cidade.trim()) q = q.ilike('cidade', `%${f.cidade.trim()}%`)
  if (f.estado && f.estado.trim()) q = q.ilike('estado', f.estado.trim())
  // Intervalo de data MEIO-ABERTO [início, próximo-dia): `.lt` no fim cobre o dia
  // inteiro sem perder registro por horário/borda (item 4). O fim já vem como o
  // início do dia seguinte (ver inicioDiaUTC/fimExclusivoUTC em base-leads).
  if (f.cadastroDe) q = q.gte('created_at', f.cadastroDe)
  if (f.cadastroAte) q = q.lt('created_at', f.cadastroAte)
  if (f.interacaoDe) q = q.gte('ultimo_contato', f.interacaoDe)
  if (f.interacaoAte) q = q.lt('ultimo_contato', f.interacaoAte)

  // Atalhos rápidos (chips) → restrições por estágio.
  if (f.atalho === 'responderam') q = q.in('estagio', ['interessado', 'respondeu', 'com_closer'])
  else if (f.atalho === 'sem_resposta' || f.atalho === 'reativacao') q = q.eq('estagio', 'sem_resposta')
  else if (f.atalho === 'arquivados') q = q.or('perdido.eq.true,estagio.eq.perdido,estagio.eq.descartado')

  const ordenarPor = f.ordenarPor ?? { campo: 'created_at' as const, asc: false }
  q = q.order(ordenarPor.campo, { ascending: ordenarPor.asc, nullsFirst: false })
  // Desempate por id: colunas de baixa cardinalidade (segmento, canal, estágio)
  // empatam milhares de linhas — sem ordem total, a página 2 pode repetir ou
  // pular leads da página 1.
  q = q.order('id', { ascending: true })

  const { data, error, count } = await q.range(offset, offset + limit - 1)
  if (error) {
    console.error('getTodosLeads:', error)
    return { data: [], total: 0 }
  }
  return { data: (data ?? []) as Lead[], total: count ?? 0 }
}

export async function getLeadById(id: string): Promise<Lead | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createLead(lead: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert(lead)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLead(id: string, updates: Partial<Lead>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateLeadEstagio(id: string, estagio: Lead['estagio']): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ estagio })
    .eq('id', id)
  if (error) throw error
}

// Atualiza o estágio de um lead e registra o último contato
export async function atualizarEstagio(leadId: string, novoEstagio: string): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({
      estagio: novoEstagio,
      ultimo_contato: new Date().toISOString(),
    })
    .eq('id', leadId)
  if (error) throw error
}

// Dispara o MOTOR (lib/engine, não mais o n8n) para executar a próxima etapa
// da cadência do lead. Trocado de /api/executar-acao (proxy do n8n, parado)
// para /api/engine/executar-acao em 06/07/2026. O endpoint do motor exige o
// header de autorização interna — por isso o NEXT_PUBLIC_INTERNAL_SECRET.
export async function executarAcao(
  leadId: string
): Promise<{ ok: boolean; estagio?: string; erro?: string; motivo?: string }> {
  const res = await fetch('/api/engine/executar-acao', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.NEXT_PUBLIC_INTERNAL_SECRET ?? '',
    },
    body: JSON.stringify({ lead_id: leadId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? err.motivo ?? `Erro ${res.status}`)
  }

  return res.json()
}

// INTELIGÊNCIA COMERCIAL POR LEAD (sprint item 4): dispara a rota server-side
// que chama a IA (Haiku) e devolve a leitura comercial do lead. Sob demanda —
// não é chamada no load do painel para não gastar tokens à toa.
export interface InsightComercialLead {
  aderencia: 'alta' | 'media' | 'baixa'
  oportunidade: string
  dor: string
  abordagem: string
}

export async function gerarInsightLead(leadId: string): Promise<InsightComercialLead> {
  const res = await fetch(`/api/leads/${leadId}/insight`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? `Erro ${res.status}`)
  }
  const { insight } = await res.json()
  return insight as InsightComercialLead
}

// PRÓXIMA MENSAGEM da cadência (ficha lateral — botão "Gerar mensagem"). Preview
// real montado pelo motor (template + variáveis), sem enviar nada.
export interface MensagemPreview {
  assunto: string
  corpo: string
  tipo: 'abordagem' | 'follow_up'
  numero: number | null
}

export async function gerarMensagemLead(leadId: string): Promise<MensagemPreview> {
  const res = await fetch(`/api/leads/${leadId}/mensagem`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? `Erro ${res.status}`)
  }
  return (await res.json()) as MensagemPreview
}

// COPILOTO PÓS-REUNIÃO (item 8): manda a transcrição colada + o lead e recebe a
// análise estruturada da IA. Import de tipo (erasado no build — não puxa o
// módulo server-only da IA pro bundle do browser).
export async function analisarReuniaoCopiloto(
  leadId: string | null,
  transcricao: string,
): Promise<import('./ia/copilotoReuniao').AnaliseReuniao> {
  const res = await fetch('/api/copiloto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, transcricao }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? `Erro ${res.status}`)
  }
  const { analise } = await res.json()
  return analise as import('./ia/copilotoReuniao').AnaliseReuniao
}

// Registra uma interação/nota no histórico
export async function registrarNota(leadId: string, descricao: string, tipo: string = 'nota'): Promise<void> {
  const { error } = await supabase
    .from('interacoes')
    .insert({
      lead_id: leadId,
      tipo,
      canal: 'plataforma',
      descricao,
      origem_acao: 'humano',
    })
  if (error) throw error
}

// --- CENTRAL DE RESPOSTAS -------------------------------------------------
// Conversas = leads que RESPONDERAM. O sinal de resposta é `interacoes` com
// tipo='resposta' (gravado por lib/engine/flows/detectarResposta ao ler a
// caixa). Não existe tabela de mensagens própria nem estado de "lido": o
// status da conversa é derivado de `leads.proxima_acao`, que é o que o motor
// realmente mantém — 'aguardando_closer' = resposta ainda não tratada,
// 'com_closer' = já encaminhada ao closer.
// Isolamento por organização vem da RLS (client de browser com a sessão).

// Canais que contam como MENSAGEM de conversa. 'sistema'/'plataforma' são notas
// internas (tarefa, bounce, log) e não entram no fio da conversa.
export const CANAIS_CONVERSA = ['email', 'whatsapp']
const TIPOS_MENSAGEM = ['abordagem', 'follow_up', 'nota', 'resposta']
const LIMITE_RESPOSTAS = 500

export type StatusConversa = 'novo' | 'pendente' | 'respondido'

export interface ConversaResposta {
  lead: Lead
  status: StatusConversa
  canal: string            // canal da última resposta recebida (define o selo)
  canais: string[]         // TODOS os canais com resposta neste lead (filtro)
  ultimaRespostaEm: string // data da última inbound, em qualquer canal
  trecho: string           // prévia da última resposta
  totalRespostas: number
}

// Corpo das mensagens do motor vem como "**Assunto**\n\ncorpo". Separa os dois
// para a UI poder mostrar assunto e texto sem os asteriscos.
export function separarAssuntoCorpo(descricao: string): { assunto: string | null; corpo: string } {
  const m = /^\*\*(.+?)\*\*\s*\n+([\s\S]*)$/.exec(descricao ?? '')
  if (!m) return { assunto: null, corpo: descricao ?? '' }
  return { assunto: m[1].trim(), corpo: m[2].trim() }
}

// Status da conversa. A regra de e-mail é a original e não muda: vem de
// `leads.proxima_acao`, que o motor mantém no fluxo de detecção de resposta.
// WhatsApp é a exceção: o webhook NÃO toca em `proxima_acao`, então para uma
// conversa cuja última entrada é WhatsApp esse campo não diz nada sobre ela —
// tratamos como 'novo'. Sem status novo, sem tabela nova.
function statusDaConversa(lead: Lead, ultimoCanal: string): StatusConversa {
  if (ultimoCanal === 'whatsapp') return 'novo'
  if (lead.proxima_acao === 'aguardando_closer') return 'novo'
  if (lead.proxima_acao === 'com_closer') return 'pendente'
  return 'respondido'
}

interface EntradaConversa {
  canal: string
  trecho: string
  em: string
  total: number
  canais: Set<string>
}

// Guarda a entrada mais recente por lead e acumula canais/contagem. As duas
// fontes (interacoes e whatsapp_mensagens) passam por aqui — o lead é a chave,
// então nunca vira duas conversas.
function registrar(mapa: Map<string, EntradaConversa>, leadId: string, dados: { canal: string; trecho: string; em: string }) {
  const atual = mapa.get(leadId)
  if (!atual) {
    mapa.set(leadId, { ...dados, total: 1, canais: new Set([dados.canal]) })
    return
  }
  atual.total += 1
  atual.canais.add(dados.canal)
  // Mais recente vence: define selo, data e trecho da lista.
  if (dados.em > atual.em) {
    atual.canal = dados.canal
    atual.trecho = dados.trecho
    atual.em = dados.em
  }
}

export async function getConversasResposta(filtros: PipelineColFiltros = {}): Promise<ConversaResposta[]> {
  const porLead = new Map<string, EntradaConversa>()

  // Fonte 1 — E-MAIL (inalterada): interacoes tipo='resposta'.
  const { data: respostas, error } = await supabase
    .from('interacoes')
    .select('lead_id, canal, descricao, created_at')
    .eq('tipo', 'resposta')
    .in('canal', CANAIS_CONVERSA)
    .order('created_at', { ascending: false })
    .limit(LIMITE_RESPOSTAS)
  if (error) {
    console.error('getConversasResposta:', error)
    return []
  }
  for (const linha of respostas ?? []) {
    const id = linha.lead_id as string | null
    if (!id) continue
    registrar(porLead, id, {
      canal: (linha.canal as string) ?? 'email',
      trecho: separarAssuntoCorpo(linha.descricao as string).corpo.replace(/\s+/g, ' ').trim(),
      em: linha.created_at as string,
    })
  }

  // Fonte 2 — WHATSAPP: mensagens inbound já vinculadas a um lead. A RLS de
  // `whatsapp_mensagens` filtra por organizacao_id; mensagem sem vínculo tem
  // organizacao_id NULL e não aparece. Nada é copiado para `interacoes` — a
  // união acontece só aqui, na leitura. Falha degrada para "sem WhatsApp".
  const { data: zaps, error: zapError } = await supabase
    .from('whatsapp_mensagens')
    .select('lead_id, conteudo, mensagem_em, created_at, tipo')
    .not('lead_id', 'is', null)
    .eq('direcao', 'inbound')
    .order('mensagem_em', { ascending: false })
    .limit(LIMITE_RESPOSTAS)
  if (zapError) {
    console.error('getConversasResposta/whatsapp:', zapError)
  } else {
    for (const msg of zaps ?? []) {
      const id = msg.lead_id as string
      const texto = (msg.conteudo as string | null)?.replace(/\s+/g, ' ').trim()
      registrar(porLead, id, {
        canal: 'whatsapp',
        // Tipos sem texto (áudio, imagem, sticker) não têm conteúdo: mostra o tipo.
        trecho: texto || `[${msg.tipo ?? 'mensagem'}]`,
        em: (msg.mensagem_em as string) ?? (msg.created_at as string),
      })
    }
  }

  if (porLead.size === 0) return []

  const { responsavel, segmento, canal, busca } = filtros
  const orResponsavel = responsavel ? await filtroResponsavelOr(responsavel) : null
  const ids = [...porLead.keys()]
  const leads: Lead[] = []
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    let q = supabase
      .from('leads')
      .select('*, usuarios:responsavel_id (id, nome)')
      .in('id', ids.slice(i, i + LOTE_IDS))
    if (orResponsavel) q = q.or(orResponsavel)
    if (segmento) q = q.eq('segmento', segmento)
    if (busca && busca.trim()) {
      const t = busca.trim().replace(/[%,()]/g, ' ')
      q = q.or(`empresa.ilike.%${t}%,contato_nome.ilike.%${t}%,contato_email.ilike.%${t}%`)
    }
    const { data, error: leadError } = await q
    if (leadError) {
      console.error('getConversasResposta/leads:', leadError)
      return []
    }
    leads.push(...((data ?? []) as Lead[]))
  }

  const conversas = leads.map((lead) => {
    const meta = porLead.get(lead.id)!
    return {
      lead,
      status: statusDaConversa(lead, meta.canal),
      canal: meta.canal,
      canais: [...meta.canais],
      ultimaRespostaEm: meta.em,
      trecho: meta.trecho,
      totalRespostas: meta.total,
    }
  })

  // Filtro de canal da CONVERSA (não `canal_preferencial` do lead): casa com
  // QUALQUER canal que o lead tenha, não só o da última resposta. Um lead com
  // e-mail + WhatsApp aparece nos dois filtros — e uma vez só em cada.
  const filtradas = canal ? conversas.filter((c) => c.canais.includes(canal)) : conversas
  return filtradas.sort((a, b) => b.ultimaRespostaEm.localeCompare(a.ultimaRespostaEm))
}

// Fio da conversa: só mensagens de canal real, em ordem cronológica.
// Reusa getInteracoesByLead (mesma fonte do painel do lead).
export interface MensagemConversa {
  id: string
  entrada: boolean // true = recebida do lead; false = enviada por nós
  canal: string
  assunto: string | null
  corpo: string
  em: string
  autor: string | null
}

export async function getConversaDoLead(leadId: string): Promise<MensagemConversa[]> {
  // As duas fontes seguem separadas no banco; a união é só de leitura. A de
  // WhatsApp é best-effort: se falhar, o histórico de e-mail continua servindo.
  const [interacoes, zaps] = await Promise.all([
    getInteracoesByLead(leadId),
    getMensagensWhatsappByLead(leadId).catch((erro) => {
      console.error('getConversaDoLead/whatsapp:', erro)
      return [] as MensagemWhatsapp[]
    }),
  ])

  const deInteracoes: MensagemConversa[] = interacoes
    .filter((i) => TIPOS_MENSAGEM.includes(i.tipo) && CANAIS_CONVERSA.includes(i.canal ?? ''))
    .map((i) => {
      const { assunto, corpo } = separarAssuntoCorpo(i.descricao)
      return {
        id: i.id,
        entrada: i.tipo === 'resposta',
        canal: i.canal ?? 'email',
        assunto,
        corpo,
        em: i.created_at,
        autor: i.usuarios?.nome ?? null,
      }
    })

  const deWhatsapp: MensagemConversa[] = zaps.map((m) => ({
    id: m.id,
    entrada: m.direcao !== 'outbound',
    canal: 'whatsapp',
    assunto: null,
    // Tipos sem texto (áudio, imagem, sticker) chegam com conteudo null.
    corpo: m.conteudo ?? `[${m.tipo}]`,
    em: m.mensagem_em || m.created_at,
    autor: m.remetente_nome,
  }))

  return [...deInteracoes, ...deWhatsapp].sort((a, b) => a.em.localeCompare(b.em))
}

// --- INTERACOES ---

export async function getInteracoesByLead(leadId: string): Promise<Interacao[]> {
  const { data, error } = await supabase
    .from('interacoes')
    .select(`
      *,
      usuarios:responsavel_id (
        id,
        nome
      )
    `)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createInteracao(interacao: Partial<Interacao>): Promise<Interacao> {
  const { data, error } = await supabase
    .from('interacoes')
    .insert(interacao)
    .select()
    .single()
  if (error) throw error
  if (interacao.canal === 'email' && interacao.lead_id) {
    const { error: leadError } = await supabase
      .from('leads')
      .update({ ultimo_contato: data.created_at ?? new Date().toISOString() })
      .eq('id', interacao.lead_id)
    // A interação já foi criada. Evita sugerir ao usuário que repita o registro
    // e gerar uma duplicidade; o painel usa a própria interação como fallback.
    if (leadError) console.warn('Interação registrada sem sincronizar o último contato do lead.')
  }
  return data
}

// --- MENSAGENS WHATSAPP (aba Conversa) ---

// Mensagens reais de WhatsApp já vinculadas a um lead. Fonte única:
// `whatsapp_mensagens` — não duplicamos em `interacoes`. Somente leitura.
//
// Isolamento: a policy de SELECT da tabela filtra `organizacao_id =
// current_org_id()`; mensagem ainda não vinculada tem `organizacao_id` NULL e
// nunca retorna aqui. `mensagem_em` (timestamp da Meta) é a cronologia; a UI
// cai para `created_at` se preciso.
export async function getMensagensWhatsappByLead(leadId: string): Promise<MensagemWhatsapp[]> {
  const { data, error } = await supabase
    .from('whatsapp_mensagens')
    .select('id, lead_id, organizacao_id, direcao, remetente, remetente_nome, tipo, conteudo, mensagem_em, created_at')
    .eq('lead_id', leadId)
    .order('mensagem_em', { ascending: false })
  if (error) throw error
  return (data ?? []) as MensagemWhatsapp[]
}

// --- USUARIOS ---

export async function getUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('ativo', true)
  if (error) throw error
  return data || []
}

// --- TEMPLATES ---

// Cria um template / variante (A/B, item 6). A organizacao_id é resolvida no
// servidor (auth), nunca enviada pelo cliente.
export async function criarTemplate(dados: {
  nome: string; tipo: string; canal: string; nicho: string | null; assunto: string | null; corpo: string
}): Promise<Template> {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.erro ?? `Erro ${res.status}`)
  }
  const { template } = await res.json()
  return template as Template
}

export interface SegmentoConhecido {
  nicho: string
  // Existe mensagem de primeiro contato ativa para este segmento? Mesma regra
  // da prévia de importação (canal e-mail + tipo primeiro_contato + ativo).
  // Sem ela, o motor NÃO aborda um lead desse segmento.
  temTemplate: boolean
}

// Segmentos que a organização já conhece: os que têm mensagem de primeiro
// contato e os que já aparecem em algum lead. A união importa porque uma base
// recém-importada costuma ter segmento antes de ter template — sugerir só os
// com template deixaria o campo vazio justamente em quem está começando.
export async function getSegmentosConhecidos(): Promise<SegmentoConhecido[]> {
  const [templates, leads] = await Promise.all([
    supabase
      .from('templates')
      .select('nicho')
      .eq('canal', 'email')
      .eq('tipo', 'primeiro_contato')
      .eq('ativo', true)
      .not('nicho', 'is', null),
    supabase.from('leads').select('segmento').not('segmento', 'is', null),
  ])
  if (templates.error) throw templates.error
  if (leads.error) throw leads.error

  const norm = (v: unknown) => normalizarNicho(typeof v === 'string' ? v : null)
  const comTemplate = new Set(
    (templates.data ?? []).map((t) => norm((t as { nicho: string | null }).nicho)).filter((n): n is string => !!n),
  )
  const usados = (leads.data ?? [])
    .map((l) => norm((l as { segmento: string | null }).segmento))
    .filter((n): n is string => !!n)

  return [...new Set([...comTemplate, ...usados])]
    .sort((x, y) => x.localeCompare(y, 'pt-BR'))
    .map((nicho) => ({ nicho, temTemplate: comTemplate.has(nicho) }))
}

export async function getTemplates(): Promise<Template[]> {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  // A biblioteca mostra só o que o usuário escreveu; os templates gerados ao
  // ativar uma campanha ("campanha_<id>_m1") vivem dentro da campanha.
  return apenasTemplatesAutorais(data || [])
}

// --- ANALYTICS / DASHBOARD ---

export async function getLeadsStats() {
  const { data, error } = await supabase
    .from('leads')
    .select('estagio, score, responsavel_id, created_at, canal_preferencial, segmento, estado')
  if (error || !data) return null
  return data
}

// INTELIGÊNCIA COMERCIAL (dado real mínimo p/ apresentação): dois KPIs reais,
// escopados à organização pela MESMA trava de RLS da Base de Leads (client de
// cookie/SSR — auth.uid() resolve as policies). Usa count HEAD (não traz linha,
// só o total) — barato mesmo com a base cheia. "Conversões" = leads em
// estagio='ganho' (único estágio de fechamento hoje, ver lib/pipeline-stages).
export async function getInteligenciaComercialResumo(): Promise<{
  totalLeads: number
  conversoes: number
}> {
  const [totalRes, ganhoRes] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('estagio', 'ganho'),
  ])
  if (totalRes.error) throw totalRes.error
  if (ganhoRes.error) throw ganhoRes.error
  return { totalLeads: totalRes.count ?? 0, conversoes: ganhoRes.count ?? 0 }
}

// INTELIGÊNCIA COMERCIAL COMPLETA (item 5): carrega o dado bruto mínimo — leads
// (colunas usadas nas agregações) + interações dos últimos 180 dias — escopado à
// organização pela RLS (client de cookie/SSR). A agregação é feita em memória
// pelas funções puras de lib/inteligencia.ts. As interações são limitadas por
// data e colunas para não puxar a tabela inteira ao browser.
export async function getDadosInteligenciaComercial(): Promise<{
  leads: import('./inteligencia').LeadIC[]
  interacoes: import('./inteligencia').InteracaoIC[]
  templates: import('./inteligencia').TemplateVarianteIC[]
}> {
  const desde180 = new Date()
  desde180.setDate(desde180.getDate() - 180)
  const [leadsRes, interacoesRes, templatesRes] = await Promise.all([
    supabase
      .from('leads')
      .select('id, empresa, estagio, score, canal_preferencial, segmento, estado, created_at, ultimo_contato, responsavel_nome, followups_enviados'),
    supabase
      .from('interacoes')
      .select('tipo, canal, created_at, lead_id, template_id')
      .gte('created_at', desde180.toISOString()),
    // Variantes de template (A/B, item 6) para rotular a taxa por variante.
    supabase.from('templates').select('id, nome, tipo, nicho').eq('canal', 'email'),
  ])
  if (leadsRes.error) throw leadsRes.error
  if (interacoesRes.error) throw interacoesRes.error
  if (templatesRes.error) throw templatesRes.error
  return {
    leads: (leadsRes.data ?? []) as import('./inteligencia').LeadIC[],
    interacoes: (interacoesRes.data ?? []) as import('./inteligencia').InteracaoIC[],
    templates: (templatesRes.data ?? []) as import('./inteligencia').TemplateVarianteIC[],
  }
}

export async function getLeadsRecentes(limit = 10) {
  const { data, error } = await supabase
    .from('leads')
    .select('*, usuarios:responsavel_id (id, nome)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data
}

export async function getLeadsPorResponsavel() {
  const { data: usuarios, error: errU } = await supabase
    .from('usuarios')
    .select('id, nome')
  const { data: leads, error: errL } = await supabase
    .from('leads')
    .select('responsavel_id, responsavel_nome, estagio')
  if (errU || errL || !usuarios || !leads) return []

  // Mesmo padrão do filtroResponsavelOr, aplicado em memória: casa por FK
  // (responsavel_id) OU por prefixo do nome legado do CSV ("Francisco" →
  // "Francisco Rufino"). `responsavel_id` NÃO é fonte de verdade hoje —
  // nenhum fluxo do app grava essa coluna; todos os leads vieram do import
  // HubSpot, que só preenche responsavel_nome.
  const doResponsavel = (
    l: { responsavel_id?: string | null; responsavel_nome?: string | null },
    u: { id: string; nome: string },
  ) =>
    l.responsavel_id === u.id ||
    (!!l.responsavel_nome && l.responsavel_nome.toLowerCase().startsWith(u.nome.toLowerCase()))

  return usuarios.map(u => {
    const meus = leads.filter(l => doResponsavel(l, u))
    return {
      nome: u.nome,
      total: meus.length,
      reunioes: meus.filter(l => l.estagio === 'reuniao_agendada').length,
      interessados: meus.filter(l => l.estagio === 'interessado').length,
    }
  })
}
