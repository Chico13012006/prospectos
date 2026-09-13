import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'
import {
  operacaoEfetiva,
  parseWorkspaceConfig,
  renovacaoEfetiva,
} from '@/lib/config/workspaceConfig'
import {
  consolidarValidades,
  diasAteVencimento,
  naJanelaRenovacao,
  resumirValidades,
} from '@/lib/servicos/vencimento'
import {
  agruparVencimentosPorCliente,
  filtroResponsavelDashboard,
  parearCiclosRenovados,
  podeVerDashboardDaEquipe,
  resumirInteracoesProspeccao,
  resumirEmpresasVencimento,
  serieTemporal,
  situacaoRenovacao,
  variacaoPercentual,
  type InteracaoProspeccaoMetrica,
  type LeadCadenciaProspeccaoMetrica,
  type RegistroControleVencimento,
  type SituacaoRenovacao,
} from '@/lib/operacao/dashboard'
import { TIPOS_INTERACAO_ENVIO } from '@/lib/cadencia/classificacao'

export const runtime = 'nodejs'

const TODOS_WIDGETS = ['leads', 'tarefas', 'oportunidades', 'pipeline', 'campanhas', 'renovacoes'] as const

interface ServicoRow {
  id: string
  empresa_id: string | null
  tipo: string | null
  vencimento_em: string | null
}

interface LeadOperacaoRow {
  id: string
  empresa_id: string | null
  empresa: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  ultimo_contato: string | null
  proxima_acao_data: string | null
}

interface LeadValidadeRow extends LeadOperacaoRow {
  data_validade: string | null
}

interface ExecucaoRenovacaoRow {
  id: string
  lead_id: string | null
  campanha_id: string | null
  status: string
  proxima_verificacao_em: string | null
  iniciado_em: string
  atualizado_em: string
}

interface EventoEmailRow {
  id: number | string
  execucao_id: string
  criado_em: string
  detalhe: Record<string, unknown> | null
}

interface InteracaoRenovacaoRow {
  id: string
  lead_id: string
  created_at: string
}

interface LeadComunicacaoRow {
  id: string
  empresa_id: string | null
  empresa: string | null
}

interface UsuarioResponsavelRow {
  id: string
  nome: string | null
}

interface LeadCicloRow {
  id: string
  empresa_id: string | null
  empresa: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
}

interface CicloLaudoDashboardRow {
  id: string
  lead_id: string
  validade_em: string
  renovado_em: string | null
  criado_em: string
  leads: LeadCicloRow | LeadCicloRow[] | null
}

interface AtividadeProspeccaoRow {
  id: string
  lead_id: string
  tipo: string
  canal: string | null
  origem_acao: string | null
  descricao: string | null
  created_at: string
  leads: { id: string; empresa: string | null } | { id: string; empresa: string | null }[] | null
}

interface LeadMetricaProspeccaoRow {
  id: string
  empresa: string | null
  created_at: string
}

interface LeadInteracaoMetricaRow {
  id: string
  segmento: string | null
  estado: string | null
}

interface InteracaoMetricaProspeccaoRow {
  id: string
  lead_id: string
  tipo: string
  canal: string | null
  origem_acao: string | null
  created_at: string
  leads: LeadInteracaoMetricaRow | LeadInteracaoMetricaRow[] | null
}

interface LeadExecucaoCadenciaRow {
  id: string
  estagio: string | null
}

interface ExecucaoCadenciaDashboardRow {
  id: string
  lead_id: string | null
  iniciado_em: string
  leads: LeadExecucaoCadenciaRow | LeadExecucaoCadenciaRow[] | null
}

interface OportunidadeMetricaProspeccaoRow {
  id: string
  criado_em: string
}

interface QueryComOr {
  or(filters: string, options?: { referencedTable?: string }): this
}

function aplicarFiltro<T extends QueryComOr>(
  query: T,
  filtro: string | null,
  referencedTable?: string,
): T {
  if (!filtro) return query
  return query.or(filtro, referencedTable ? { referencedTable } : undefined)
}

function leadDaAtividade(valor: AtividadeProspeccaoRow['leads']) {
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function leadDaInteracaoMetrica(valor: InteracaoMetricaProspeccaoRow['leads']) {
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function leadDaExecucaoCadencia(valor: ExecucaoCadenciaDashboardRow['leads']) {
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function leadDoCiclo(valor: CicloLaudoDashboardRow['leads']): LeadCicloRow | null {
  return Array.isArray(valor) ? valor[0] ?? null : valor
}

function tabelaCiclosIndisponivel(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  return erro.code === '42P01'
    || erro.code === 'PGRST205'
    || erro.message?.includes("public.laudo_ciclos") === true
}

function inicioDoMesUTC(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
}

function dataMaisRecente(valores: Array<string | null | undefined>): string | null {
  return valores
    .flatMap((valor) => {
      if (!valor) return []
      const timestamp = new Date(valor).getTime()
      return Number.isNaN(timestamp) ? [] : [{ valor, timestamp }]
    })
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.valor ?? null
}

function proximaData(valores: Array<string | null | undefined>, agora: Date): string | null {
  const timestampAgora = agora.getTime()
  return valores
    .flatMap((valor) => {
      if (!valor) return []
      const timestamp = new Date(valor).getTime()
      return Number.isNaN(timestamp) || timestamp < timestampAgora ? [] : [{ valor, timestamp }]
    })
    .sort((a, b) => a.timestamp - b.timestamp)[0]?.valor ?? null
}

export async function GET(request: NextRequest) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, role, user } = acc.acesso

  try {
    const agora = new Date()
    const desde30 = new Date(agora)
    desde30.setUTCDate(desde30.getUTCDate() - 30)
    const desde60 = new Date(agora)
    desde60.setUTCDate(desde60.getUTCDate() - 60)
    const inicioMes = inicioDoMesUTC(agora)
    const head = { count: 'exact' as const, head: true }

    const { data: orgRow, error: orgErro } = await admin
      .from('organizacoes')
      .select('configuracoes')
      .eq('id', org)
      .maybeSingle()
    if (orgErro) throw orgErro

    const cfg = parseWorkspaceConfig(orgRow?.configuracoes)
    const operacao = operacaoEfetiva(cfg)
    const antecedencia = renovacaoEfetiva(cfg).antecedenciaDias

    const podeVerEquipe = podeVerDashboardDaEquipe(role)
    const responsavelSolicitado = request.nextUrl.searchParams.get('responsavel')?.trim() || null
    const authIdEscopo = podeVerEquipe ? responsavelSolicitado : user.id
    const { data: perfisEquipe, error: perfisEquipeErro } = await admin
      .from('perfis')
      .select('id, nome, role')
      .eq('organizacao_id', org)
      .order('nome', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
    if (perfisEquipeErro) throw perfisEquipeErro

    if (responsavelSolicitado && podeVerEquipe && !(perfisEquipe ?? []).some((perfil) => perfil.id === responsavelSolicitado)) {
      return NextResponse.json({ erro: 'O responsável selecionado não pertence a esta organização.' }, { status: 400 })
    }

    const vinculoResponsavel = authIdEscopo
      ? await resolverResponsavelPorAuthId(admin, org, authIdEscopo)
      : null
    if (authIdEscopo && (!vinculoResponsavel || !vinculoResponsavel.ok)) {
      return NextResponse.json({
        erro: 'Este membro ainda não está vinculado a um usuário comercial. Ajuste o cadastro da equipe antes de filtrar a carteira.',
      }, { status: 409 })
    }
    const escopoResponsavel = vinculoResponsavel?.ok ? {
      authId: authIdEscopo!,
      id: vinculoResponsavel.usuario.id,
      nome: vinculoResponsavel.usuario.nome?.trim()
        || (perfisEquipe ?? []).find((perfil) => perfil.id === authIdEscopo)?.nome?.trim()
        || 'Comercial',
    } : null
    const filtroLead = escopoResponsavel
      ? filtroResponsavelDashboard(escopoResponsavel.id, escopoResponsavel.nome)
      : null
    const filtroResponsavelDireto = escopoResponsavel ? `responsavel_id.eq.${escopoResponsavel.id}` : null

    const selectInteracaoContagem = filtroLead
      ? 'id, leads!inner(responsavel_id, responsavel_nome)'
      : 'id'

    const leadsQPromise = aplicarFiltro(
      admin.from('leads').select('id', head).eq('organizacao_id', org),
      filtroLead,
    )
    const tarefasQPromise = aplicarFiltro(
      admin.from('tarefas').select('id', head).eq('organizacao_id', org).in('status', ['aberta', 'em_andamento']),
      filtroResponsavelDireto,
    )
    const oportQPromise = aplicarFiltro(
      admin.from('oportunidades').select('id', head).eq('organizacao_id', org).eq('status', 'aberta'),
      filtroResponsavelDireto,
    )
    const campQPromise = aplicarFiltro(
      admin.from('campanhas').select('id', head).eq('organizacao_id', org).eq('status', 'ativa'),
      escopoResponsavel ? `publico->>responsavel_id.eq.${escopoResponsavel.authId}` : null,
    )
    const oportRowsPromise = aplicarFiltro(
      admin.from('oportunidades').select('valor').eq('organizacao_id', org).eq('status', 'aberta'),
      filtroResponsavelDireto,
    )
    const novosQPromise = aplicarFiltro(
      admin.from('leads').select('id', head).eq('organizacao_id', org).gte('created_at', desde30.toISOString()),
      filtroLead,
    )
    const contatadosQPromise = aplicarFiltro(
      admin.from('leads').select('id', head).eq('organizacao_id', org).gte('ultimo_contato', desde30.toISOString()),
      filtroLead,
    )
    const enviadosQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .in('tipo', TIPOS_INTERACAO_ENVIO).eq('canal', 'email').eq('origem_acao', 'ia')
        .gte('created_at', desde30.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const respostasQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .eq('tipo', 'resposta').gte('created_at', desde30.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const reunioesQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .eq('tipo', 'reuniao').gte('created_at', desde30.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const contatadosMesQPromise = aplicarFiltro(
      admin.from('leads').select('id', head).eq('organizacao_id', org).gte('ultimo_contato', inicioMes.toISOString()),
      filtroLead,
    )
    const reunioesMesQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .eq('tipo', 'reuniao').gte('created_at', inicioMes.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const tarefasProspeccaoRowsPromise = aplicarFiltro(
      admin.from('tarefas').select('id, lead_id, titulo, prioridade, prazo_em, tipo')
        .eq('organizacao_id', org).in('status', ['aberta', 'em_andamento'])
        .or('tipo.is.null,tipo.neq.renovacao')
        .order('prazo_em', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).limit(5),
      filtroResponsavelDireto,
    )
    const atividadesProspeccaoPromise = aplicarFiltro(
      admin.from('interacoes')
        .select('id, lead_id, tipo, canal, origem_acao, descricao, created_at, leads!inner(id, empresa, responsavel_id, responsavel_nome)')
        .eq('organizacao_id', org)
        .in('tipo', [...TIPOS_INTERACAO_ENVIO, 'resposta', 'reuniao'])
        .gte('created_at', desde30.toISOString())
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(24),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const novosAnteriorQPromise = aplicarFiltro(
      admin.from('leads').select('id', head).eq('organizacao_id', org)
        .gte('created_at', desde60.toISOString()).lt('created_at', desde30.toISOString()),
      filtroLead,
    )
    const enviadosAnteriorQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .in('tipo', TIPOS_INTERACAO_ENVIO).eq('canal', 'email').eq('origem_acao', 'ia')
        .gte('created_at', desde60.toISOString()).lt('created_at', desde30.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const respostasAnteriorQPromise = aplicarFiltro(
      admin.from('interacoes').select(selectInteracaoContagem, head).eq('organizacao_id', org)
        .eq('tipo', 'resposta')
        .gte('created_at', desde60.toISOString()).lt('created_at', desde30.toISOString()),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )

    // A criação de uma oportunidade de prospecção é o evento persistido que
    // representa o repasse de um lead qualificado ao comercial. Renovações são
    // excluídas desse KPI; registros legados sem origem continuam incluídos.
    const oportunidadesQualificadasBase = admin.from('oportunidades').select('id', head)
      .eq('organizacao_id', org)
      .or('origem.is.null,origem.neq.renovacao')
      .gte('criado_em', desde30.toISOString()).lt('criado_em', agora.toISOString())
    const oportunidadesQualificadasQPromise = escopoResponsavel
      ? oportunidadesQualificadasBase.eq('responsavel_id', escopoResponsavel.id)
      : oportunidadesQualificadasBase
    const oportunidadesAnterioresBase = admin.from('oportunidades').select('id', head)
      .eq('organizacao_id', org)
      .or('origem.is.null,origem.neq.renovacao')
      .gte('criado_em', desde60.toISOString()).lt('criado_em', desde30.toISOString())
    const oportunidadesAnterioresQPromise = escopoResponsavel
      ? oportunidadesAnterioresBase.eq('responsavel_id', escopoResponsavel.id)
      : oportunidadesAnterioresBase

    const leadsMetricasPromise = aplicarFiltro(
      admin.from('leads').select('id, empresa, created_at')
        .eq('organizacao_id', org)
        .gte('created_at', desde60.toISOString()).lt('created_at', agora.toISOString())
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(5000),
      filtroLead,
    )
    const interacoesMetricasPromise = aplicarFiltro(
      admin.from('interacoes')
        .select('id, lead_id, tipo, canal, origem_acao, created_at, leads!inner(id, segmento, estado, responsavel_id, responsavel_nome)')
        .eq('organizacao_id', org)
        .in('tipo', [...TIPOS_INTERACAO_ENVIO, 'resposta'])
        .lt('created_at', agora.toISOString())
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(5000),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const execucoesCadenciaBase = admin.from('workflow_execucoes')
      .select('id, lead_id, iniciado_em, leads!inner(id, estagio, responsavel_id, responsavel_nome)')
      .eq('organizacao_id', org)
      .eq('leads.organizacao_id', org)
      .not('lead_id', 'is', null)
      .order('iniciado_em', { ascending: true }).order('id', { ascending: true }).limit(5000)
    const execucoesCadenciaPromise = filtroLead
      ? execucoesCadenciaBase.or(filtroLead, { referencedTable: 'leads' })
      : execucoesCadenciaBase
    const oportunidadesSerieBase = admin.from('oportunidades').select('id, criado_em')
      .eq('organizacao_id', org)
      .or('origem.is.null,origem.neq.renovacao')
      .gte('criado_em', desde30.toISOString()).lt('criado_em', agora.toISOString())
      .order('criado_em', { ascending: true }).order('id', { ascending: true }).limit(5000)
    const oportunidadesSeriePromise = escopoResponsavel
      ? oportunidadesSerieBase.eq('responsavel_id', escopoResponsavel.id)
      : oportunidadesSerieBase

    const [
      leadsQ,
      tarefasQ,
      oportQ,
      campQ,
      servicosQ,
      validadesLegadasQ,
      oportRows,
      novosQ,
      contatadosQ,
      enviadosQ,
      respostasQ,
      reunioesQ,
      renovadosQ,
      contatadosMesQ,
      reunioesMesQ,
      tarefasProspeccaoRowsQ,
      tarefasRenovacaoRowsQ,
      campanhasRenovacaoQ,
      templatesRenovacaoQ,
      atividadesProspeccaoQ,
      novosAnteriorQ,
      enviadosAnteriorQ,
      respostasAnteriorQ,
      oportunidadesQualificadasQ,
      oportunidadesAnterioresQ,
      leadsMetricasQ,
      interacoesMetricasQ,
      execucoesCadenciaQ,
      oportunidadesSerieQ,
    ] = await Promise.all([
      leadsQPromise,
      tarefasQPromise,
      oportQPromise,
      campQPromise,
      admin.from('servicos_recorrentes').select('id, empresa_id, tipo, vencimento_em')
        .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente')
        .order('vencimento_em', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
      admin.from('leads').select('id, empresa_id, empresa, data_validade, responsavel_id, responsavel_nome, ultimo_contato, proxima_acao_data')
        .eq('organizacao_id', org).not('data_validade', 'is', null)
        .order('data_validade', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
      oportRowsPromise,
      novosQPromise,
      contatadosQPromise,
      enviadosQPromise,
      respostasQPromise,
      reunioesQPromise,
      admin.from('servicos_recorrentes').select('id', head).eq('organizacao_id', org)
        .eq('status', 'renovado').gte('atualizado_em', inicioMes.toISOString()),
      contatadosMesQPromise,
      reunioesMesQPromise,
      tarefasProspeccaoRowsPromise,
      admin.from('tarefas').select('id, lead_id, titulo, prioridade, prazo_em, tipo')
        .eq('organizacao_id', org).in('status', ['aberta', 'em_andamento']).eq('tipo', 'renovacao')
        .order('prazo_em', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).limit(5),
      admin.from('campanhas').select('id, nome').eq('organizacao_id', org).eq('tipo', 'renovacao')
        .in('status', ['ativa', 'pausada', 'concluida'])
        .order('iniciada_em', { ascending: false, nullsFirst: false }).order('id', { ascending: true }).limit(200),
      admin.from('templates').select('id').eq('organizacao_id', org).eq('canal', 'email')
        .eq('tipo', renovacaoEfetiva(cfg).templateTipo).order('id', { ascending: true }).limit(20),
      atividadesProspeccaoPromise,
      novosAnteriorQPromise,
      enviadosAnteriorQPromise,
      respostasAnteriorQPromise,
      oportunidadesQualificadasQPromise,
      oportunidadesAnterioresQPromise,
      leadsMetricasPromise,
      interacoesMetricasPromise,
      execucoesCadenciaPromise,
      oportunidadesSeriePromise,
    ])

    const consultasEssenciais = [
      leadsQ, tarefasQ, oportQ, campQ, servicosQ, validadesLegadasQ, oportRows,
      novosQ, contatadosQ, enviadosQ, respostasQ, reunioesQ, renovadosQ,
      contatadosMesQ, reunioesMesQ, tarefasProspeccaoRowsQ, tarefasRenovacaoRowsQ,
      campanhasRenovacaoQ, templatesRenovacaoQ,
      atividadesProspeccaoQ,
      novosAnteriorQ, enviadosAnteriorQ, respostasAnteriorQ,
      oportunidadesQualificadasQ, oportunidadesAnterioresQ,
      leadsMetricasQ, interacoesMetricasQ, execucoesCadenciaQ, oportunidadesSerieQ,
    ]
    const primeiraFalha = consultasEssenciais.find((query) => query.error)?.error
    if (primeiraFalha) throw primeiraFalha

    const servicos = (servicosQ.data ?? []) as ServicoRow[]
    const leadsLegados = (validadesLegadasQ.data ?? []) as LeadValidadeRow[]
    const validades = consolidarValidades(servicos, leadsLegados)
    const validade = resumirValidades(validades, agora)

    // O histórico é consultado separadamente da fila aberta. `laudo_ciclos`
    // registra o ciclo anterior e o seguinte, sem alterar a fonte autoritativa
    // da validade atual nem a classificação operacional já existente.
    const ciclosLaudoQ = await aplicarFiltro(
      admin.from('laudo_ciclos')
        .select('id, lead_id, validade_em, renovado_em, criado_em, leads!inner(id, empresa_id, empresa, responsavel_id, responsavel_nome)')
        .eq('organizacao_id', org)
        .eq('leads.organizacao_id', org)
        .order('criado_em', { ascending: false })
        .order('id', { ascending: true })
        .limit(500),
      filtroLead,
      filtroLead ? 'leads' : undefined,
    )
    const historicoCiclosDisponivel = !tabelaCiclosIndisponivel(ciclosLaudoQ.error)
    if (ciclosLaudoQ.error && historicoCiclosDisponivel) throw ciclosLaudoQ.error
    const ciclosLaudoRows = historicoCiclosDisponivel
      ? (ciclosLaudoQ.data ?? []) as CicloLaudoDashboardRow[]
      : []
    const leadsCiclos = [...new Map(ciclosLaudoRows.flatMap((ciclo) => {
      const lead = leadDoCiclo(ciclo.leads)
      return lead ? [[lead.id, lead] as const] : []
    })).values()]

    // Só resolve os clientes que podem aparecer na fila visível. As contagens
    // continuam completas, mas nomes/lead focal ficam numa leitura limitada.
    const candidatos = [...validades]
      .sort((a, b) => {
        const da = diasAteVencimento(a.vencimentoEm, agora) ?? Number.MAX_SAFE_INTEGER
        const db = diasAteVencimento(b.vencimentoEm, agora) ?? Number.MAX_SAFE_INTEGER
        return da - db || a.id.localeCompare(b.id)
      })
      .slice(0, 80)
    const empresaIds = [...new Set(candidatos.flatMap((item) => item.empresaId ? [item.empresaId] : []))]

    let empresasRows: { id: string; nome: string }[] = []
    let leadsEmpresaRows: LeadOperacaoRow[] = []
    if (empresaIds.length) {
      const [empresasQ, leadsEmpresaQ] = await Promise.all([
        admin.from('empresas').select('id, nome').eq('organizacao_id', org).in('id', empresaIds)
          .order('id', { ascending: true }),
        admin.from('leads').select('id, empresa_id, empresa, responsavel_id, responsavel_nome, ultimo_contato, proxima_acao_data')
          .eq('organizacao_id', org).in('empresa_id', empresaIds)
          .order('created_at', { ascending: true }).order('id', { ascending: true }),
      ])
      if (empresasQ.error) throw empresasQ.error
      if (leadsEmpresaQ.error) throw leadsEmpresaQ.error
      empresasRows = empresasQ.data ?? []
      leadsEmpresaRows = leadsEmpresaQ.data ?? []
    }

    const empresaNome = new Map(empresasRows.map((item) => [item.id, item.nome]))
    const leadPorEmpresa = new Map<string, LeadOperacaoRow>()
    for (const lead of leadsEmpresaRows) {
      if (lead.empresa_id && !leadPorEmpresa.has(lead.empresa_id)) leadPorEmpresa.set(lead.empresa_id, lead)
    }
    const servicoPorId = new Map(servicos.map((item) => [item.id, item]))
    const legadoPorId = new Map(leadsLegados.map((item) => [item.id, item]))

    const registrosFila: RegistroControleVencimento[] = candidatos.map((item) => {
      if (item.fonte === 'servico') {
        const servico = servicoPorId.get(item.id)
        const lead = item.empresaId ? leadPorEmpresa.get(item.empresaId) : undefined
        return {
          id: item.id,
          fonte: item.fonte,
          leadId: lead?.id ?? null,
          empresaId: item.empresaId,
          empresa: (item.empresaId ? empresaNome.get(item.empresaId) : null) ?? lead?.empresa ?? 'Cliente sem nome',
          tipo: servico?.tipo?.trim() || 'Laudo',
          vencimentoEm: item.vencimentoEm,
        }
      }
      const lead = legadoPorId.get(item.id)
      return {
        id: item.id,
        fonte: item.fonte,
        leadId: item.id,
        empresaId: item.empresaId,
        empresa: lead?.empresa?.trim() || 'Cliente sem nome',
        tipo: 'Laudo',
        vencimentoEm: item.vencimentoEm,
      }
    })

    const registrosResumo: RegistroControleVencimento[] = validades.map((item) => ({
      id: item.id,
      fonte: item.fonte,
      leadId: item.fonte === 'lead_legado' ? item.id : null,
      empresaId: item.empresaId,
      empresa: '',
      tipo: 'Laudo',
      vencimentoEm: item.vencimentoEm,
    }))
    const empresasVencimento = resumirEmpresasVencimento(registrosResumo, agora)

    const campanhasRenovacao = (campanhasRenovacaoQ.data ?? []) as { id: string; nome: string }[]
    const campanhaNome = new Map(campanhasRenovacao.map((campanha) => [campanha.id, campanha.nome]))
    const campanhaIds = campanhasRenovacao.map((campanha) => campanha.id)
    const templateIds = (templatesRenovacaoQ.data ?? []).map((template) => template.id as string)
    const leadsDaFila = [...new Set([
      ...registrosFila.flatMap((item) => item.leadId ? [item.leadId] : []),
      ...leadsEmpresaRows.map((item) => item.id),
    ])]
    const leadsOperacao = [...new Map([
      ...leadsEmpresaRows,
      ...leadsLegados.filter((lead) => leadsDaFila.includes(lead.id)),
    ].map((lead) => [lead.id, lead as LeadOperacaoRow])).values()]
    const leadOperacaoPorId = new Map(leadsOperacao.map((lead) => [lead.id, lead]))
    const chaveClientePorLead = new Map(leadsOperacao.map((lead) => [
      lead.id,
      lead.empresa_id ? `empresa:${lead.empresa_id}` : `lead:${lead.id}`,
    ]))
    const responsavelIds = [...new Set([
      ...leadsOperacao.flatMap((lead) => lead.responsavel_id ? [lead.responsavel_id] : []),
      ...leadsCiclos.flatMap((lead) => lead.responsavel_id ? [lead.responsavel_id] : []),
    ])]

    const execucoesRecentesPromise = campanhaIds.length
      ? admin.from('workflow_execucoes').select('id, lead_id, campanha_id, status, proxima_verificacao_em, iniciado_em, atualizado_em')
        .eq('organizacao_id', org).in('campanha_id', campanhaIds).not('lead_id', 'is', null)
        .order('iniciado_em', { ascending: false }).order('id', { ascending: true }).limit(300)
      : Promise.resolve({ data: [], error: null })
    const execucoesFilaPromise = campanhaIds.length && leadsDaFila.length
      ? admin.from('workflow_execucoes').select('id, lead_id, campanha_id, status, proxima_verificacao_em, iniciado_em, atualizado_em')
        .eq('organizacao_id', org).in('campanha_id', campanhaIds).in('lead_id', leadsDaFila)
        .order('iniciado_em', { ascending: false }).order('id', { ascending: true }).limit(500)
      : Promise.resolve({ data: [], error: null })
    const interacoesRecentesPromise = templateIds.length
      ? admin.from('interacoes').select('id, lead_id, created_at')
        .eq('organizacao_id', org).eq('canal', 'email').in('template_id', templateIds)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(100)
      : Promise.resolve({ data: [], error: null })
    const interacoesFilaPromise = templateIds.length && leadsDaFila.length
      ? admin.from('interacoes').select('id, lead_id, created_at')
        .eq('organizacao_id', org).eq('canal', 'email').in('template_id', templateIds).in('lead_id', leadsDaFila)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(500)
      : Promise.resolve({ data: [], error: null })
    const respostasFilaPromise = leadsDaFila.length
      ? admin.from('interacoes').select('id, lead_id, created_at')
        .eq('organizacao_id', org).eq('tipo', 'resposta').in('lead_id', leadsDaFila)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(500)
      : Promise.resolve({ data: [], error: null })
    const responsaveisPromise = responsavelIds.length
      ? admin.from('usuarios').select('id, nome').eq('organizacao_id', org).in('id', responsavelIds)
        .order('nome', { ascending: true }).order('id', { ascending: true })
      : Promise.resolve({ data: [], error: null })

    const [
      execucoesRecentesQ,
      execucoesFilaQ,
      interacoesRecentesQ,
      interacoesFilaQ,
      respostasFilaQ,
      responsaveisQ,
    ] = await Promise.all([
      execucoesRecentesPromise,
      execucoesFilaPromise,
      interacoesRecentesPromise,
      interacoesFilaPromise,
      respostasFilaPromise,
      responsaveisPromise,
    ])
    const falhaComunicacao = [
      execucoesRecentesQ,
      execucoesFilaQ,
      interacoesRecentesQ,
      interacoesFilaQ,
      respostasFilaQ,
      responsaveisQ,
    ]
      .find((query) => query.error)?.error
    if (falhaComunicacao) throw falhaComunicacao

    const execucoes = [...new Map([
      ...((execucoesRecentesQ.data ?? []) as ExecucaoRenovacaoRow[]),
      ...((execucoesFilaQ.data ?? []) as ExecucaoRenovacaoRow[]),
    ].map((execucao) => [execucao.id, execucao])).values()]
      .sort((a, b) => new Date(b.iniciado_em).getTime() - new Date(a.iniciado_em).getTime() || a.id.localeCompare(b.id))
    const execucaoPorCliente = new Map<string, ExecucaoRenovacaoRow>()
    for (const execucao of execucoes) {
      if (!execucao.lead_id) continue
      const chave = chaveClientePorLead.get(execucao.lead_id)
      if (chave && !execucaoPorCliente.has(chave)) execucaoPorCliente.set(chave, execucao)
    }
    const respostaPorCliente = new Map<string, string>()
    for (const resposta of (respostasFilaQ.data ?? []) as InteracaoRenovacaoRow[]) {
      const chave = chaveClientePorLead.get(resposta.lead_id)
      if (chave && !respostaPorCliente.has(chave)) respostaPorCliente.set(chave, resposta.created_at)
    }
    const responsavelNome = new Map(
      ((responsaveisQ.data ?? []) as UsuarioResponsavelRow[]).map((usuario) => [usuario.id, usuario.nome]),
    )
    const leadCicloPorId = new Map(leadsCiclos.map((lead) => [lead.id, lead]))
    const ciclosRenovados = parearCiclosRenovados(ciclosLaudoRows.map((ciclo) => ({
      id: ciclo.id,
      leadId: ciclo.lead_id,
      validadeEm: String(ciclo.validade_em).slice(0, 10),
      renovadoEm: ciclo.renovado_em,
      criadoEm: ciclo.criado_em,
    }))).flatMap((ciclo) => {
      const lead = leadCicloPorId.get(ciclo.leadId)
      if (!lead) return []
      const nomeResponsavel = (lead.responsavel_id ? responsavelNome.get(lead.responsavel_id) : null)
        ?? lead.responsavel_nome
        ?? null
      return [{
        ...ciclo,
        empresa: lead.empresa?.trim() || 'Cliente sem nome',
        tipo: 'Laudo',
        responsavel: nomeResponsavel ? { id: lead.responsavel_id, nome: nomeResponsavel } : null,
      }]
    })
    const leadsPorCliente = new Map<string, LeadOperacaoRow[]>()
    for (const lead of leadsOperacao) {
      const chave = chaveClientePorLead.get(lead.id)
      if (!chave) continue
      const atuais = leadsPorCliente.get(chave) ?? []
      if (!atuais.some((item) => item.id === lead.id)) atuais.push(lead)
      leadsPorCliente.set(chave, atuais)
    }
    const execucaoIds = execucoes.map((execucao) => execucao.id)
    const eventosQ = execucaoIds.length
      ? await admin.from('workflow_execucao_eventos').select('id, execucao_id, criado_em, detalhe')
        .eq('organizacao_id', org).in('execucao_id', execucaoIds).eq('tipo', 'email_enviado')
        .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(800)
      : { data: [], error: null }
    if (eventosQ.error) throw eventosQ.error

    const execucaoPorId = new Map(execucoes.map((execucao) => [execucao.id, execucao]))
    const eventosEnviados = ((eventosQ.data ?? []) as EventoEmailRow[]).flatMap((evento) => {
      if (evento.detalhe?.enviado !== true) return []
      const execucao = execucaoPorId.get(evento.execucao_id)
      if (!execucao?.lead_id) return []
      return [{
        id: `evento:${evento.id}`,
        leadId: execucao.lead_id,
        enviadaEm: evento.criado_em,
        origem: execucao.campanha_id ? campanhaNome.get(execucao.campanha_id) ?? 'Campanha de renovação' : 'Campanha de renovação',
      }]
    })
    const interacoesDiretas = [...new Map([
      ...((interacoesRecentesQ.data ?? []) as InteracaoRenovacaoRow[]),
      ...((interacoesFilaQ.data ?? []) as InteracaoRenovacaoRow[]),
    ].map((interacao) => [interacao.id, interacao])).values()].map((interacao) => ({
      id: `interacao:${interacao.id}`,
      leadId: interacao.lead_id,
      enviadaEm: interacao.created_at,
      origem: 'Renovação automática',
    }))
    const comunicacoesBrutas = [...eventosEnviados, ...interacoesDiretas]
      .sort((a, b) => new Date(b.enviadaEm).getTime() - new Date(a.enviadaEm).getTime() || a.id.localeCompare(b.id))
    const leadsComunicacaoIds = [...new Set(comunicacoesBrutas.map((item) => item.leadId))]
    let leadsComunicacao: LeadComunicacaoRow[] = []
    if (leadsComunicacaoIds.length) {
      const leadsComunicacaoQ = await admin.from('leads').select('id, empresa_id, empresa')
        .eq('organizacao_id', org).in('id', leadsComunicacaoIds)
        .order('id', { ascending: true })
      if (leadsComunicacaoQ.error) throw leadsComunicacaoQ.error
      leadsComunicacao = (leadsComunicacaoQ.data ?? []) as LeadComunicacaoRow[]
    }
    const leadComunicacaoPorId = new Map(leadsComunicacao.map((lead) => [lead.id, lead]))
    const comunicacoesPorCliente = new Map<string, {
      id: string
      leadId: string
      empresaId: string | null
      empresa: string
      enviadaEm: string
      origem: string
    }>()
    for (const comunicacao of comunicacoesBrutas) {
      const lead = leadComunicacaoPorId.get(comunicacao.leadId)
      if (!lead) continue
      const chave = lead.empresa_id ? `empresa:${lead.empresa_id}` : `lead:${lead.id}`
      if (comunicacoesPorCliente.has(chave)) continue
      comunicacoesPorCliente.set(chave, {
        id: comunicacao.id,
        leadId: lead.id,
        empresaId: lead.empresa_id,
        empresa: lead.empresa?.trim() || 'Cliente sem nome',
        enviadaEm: comunicacao.enviadaEm,
        origem: comunicacao.origem,
      })
    }
    const comunicacoesRenovacao = [...comunicacoesPorCliente.values()]
      .sort((a, b) => new Date(b.enviadaEm).getTime() - new Date(a.enviadaEm).getTime() || a.id.localeCompare(b.id))
      .slice(0, 8)

    // A fila permanece limitada e ordenada por urgência, mas agora carrega o
    // estado operacional real do cliente: campanha, execução, resposta,
    // responsável e próxima ação. Nenhum status de envio é inferido sem evento
    // ou interação persistida.
    const vencimentos = agruparVencimentosPorCliente(registrosFila, agora, 40).map((cliente) => {
      const leadsCliente = leadsPorCliente.get(cliente.chave)
        ?? (cliente.leadId ? [leadOperacaoPorId.get(cliente.leadId)].filter(Boolean) as LeadOperacaoRow[] : [])
      const leadResponsavel = leadsCliente.find((lead) => lead.responsavel_id || lead.responsavel_nome) ?? null
      const execucao = execucaoPorCliente.get(cliente.chave) ?? null
      const ultimaMensagem = comunicacoesPorCliente.get(cliente.chave) ?? null
      const ultimaRespostaEm = respostaPorCliente.get(cliente.chave) ?? null
      const situacao = situacaoRenovacao({
        execucaoStatus: execucao?.status,
        execucaoIniciadaEm: execucao?.iniciado_em,
        ultimaMensagemEm: ultimaMensagem?.enviadaEm,
        ultimaRespostaEm,
      })
      const proximaAcaoEm = situacao === 'agendado' || situacao === 'em_acompanhamento'
        ? proximaData([
            execucao?.proxima_verificacao_em,
            ...leadsCliente.map((lead) => lead.proxima_acao_data),
          ], agora)
        : null
      const ultimoContato = dataMaisRecente([
        ...leadsCliente.map((lead) => lead.ultimo_contato),
        ultimaMensagem?.enviadaEm,
        ultimaRespostaEm,
      ])

      return {
        ...cliente,
        ultimaMensagem,
        ultimaRespostaEm,
        ultimoContato,
        proximaAcaoEm,
        situacao,
        responsavel: leadResponsavel ? {
          id: leadResponsavel.responsavel_id,
          nome: (leadResponsavel.responsavel_id
            ? responsavelNome.get(leadResponsavel.responsavel_id)
            : null) ?? leadResponsavel.responsavel_nome ?? 'Responsável não identificado',
        } : null,
        campanha: execucao?.campanha_id ? {
          id: execucao.campanha_id,
          nome: campanhaNome.get(execucao.campanha_id) ?? 'Campanha de renovação',
        } : null,
        execucao: execucao ? {
          id: execucao.id,
          status: execucao.status,
          iniciadaEm: execucao.iniciado_em,
          atualizadaEm: execucao.atualizado_em,
          proximaVerificacaoEm: execucao.proxima_verificacao_em,
        } : null,
      }
    })
    const situacoes = vencimentos.reduce<Record<SituacaoRenovacao, number>>((acc, item) => {
      acc[item.situacao] += 1
      return acc
    }, {
      nao_comunicado: 0,
      agendado: 0,
      em_acompanhamento: 0,
      enviado: 0,
      respondido: 0,
      erro: 0,
      encerrado: 0,
    })

    const tarefasRows = [...(tarefasProspeccaoRowsQ.data ?? []), ...(tarefasRenovacaoRowsQ.data ?? [])]
    const tarefaLeadIds = [...new Set(tarefasRows.flatMap((t) => t.lead_id ? [t.lead_id as string] : []))]
    let tarefaLeads: { id: string; empresa: string | null }[] = []
    if (tarefaLeadIds.length) {
      const tarefaLeadsQ = await admin.from('leads').select('id, empresa')
        .eq('organizacao_id', org).in('id', tarefaLeadIds).order('id', { ascending: true })
      if (tarefaLeadsQ.error) throw tarefaLeadsQ.error
      tarefaLeads = tarefaLeadsQ.data ?? []
    }
    const nomeLead = new Map(tarefaLeads.map((lead) => [lead.id, lead.empresa]))
    const pipeline = (oportRows.data ?? []).reduce((s: number, row: { valor: number | null }) => s + (row.valor ?? 0), 0)
    const habilitados = cfg.dashboardWidgets?.length ? cfg.dashboardWidgets : [...TODOS_WIDGETS]
    const leadsMetricas = (leadsMetricasQ.data ?? []) as LeadMetricaProspeccaoRow[]
    const interacoesMetricas = ((interacoesMetricasQ.data ?? []) as InteracaoMetricaProspeccaoRow[])
      .flatMap<InteracaoProspeccaoMetrica>((interacao) => {
        const lead = leadDaInteracaoMetrica(interacao.leads)
        if (!lead) return []
        return [{
          id: interacao.id,
          leadId: interacao.lead_id,
          tipo: interacao.tipo,
          canal: interacao.canal,
          origemAcao: interacao.origem_acao,
          criadaEm: interacao.created_at,
          segmento: lead.segmento,
          estado: lead.estado,
        }]
      })
    const leadsCadencia = ((execucoesCadenciaQ.data ?? []) as ExecucaoCadenciaDashboardRow[])
      .flatMap<LeadCadenciaProspeccaoMetrica>((execucao) => {
        const lead = leadDaExecucaoCadencia(execucao.leads)
        if (!lead || !execucao.lead_id) return []
        return [{
          leadId: execucao.lead_id,
          estagio: lead.estagio,
          inscritoEm: execucao.iniciado_em,
        }]
      })
    const metricasInteracoes = resumirInteracoesProspeccao(
      interacoesMetricas,
      desde60,
      desde30,
      agora,
      leadsCadencia,
    )
    const oportunidadesSerie = (oportunidadesSerieQ.data ?? []) as OportunidadeMetricaProspeccaoRow[]
    const atividadesInteracoes = ((atividadesProspeccaoQ.data ?? []) as AtividadeProspeccaoRow[])
      .filter((atividade) => atividade.tipo !== 'nota'
        || (atividade.canal === 'email' && atividade.origem_acao === 'ia'))
      .map((atividade) => {
        const lead = leadDaAtividade(atividade.leads)
        return {
          id: atividade.id,
          leadId: atividade.lead_id,
          empresa: lead?.empresa?.trim() || 'Cliente sem nome',
          tipo: atividade.tipo,
          canal: atividade.canal,
          descricao: atividade.descricao?.trim().slice(0, 180) || null,
          realizadaEm: atividade.created_at,
        }
      })
    const atividadesNovos = leadsMetricas.flatMap((lead) => {
      const timestamp = new Date(lead.created_at).getTime()
      if (Number.isNaN(timestamp) || timestamp < desde30.getTime() || timestamp >= agora.getTime()) return []
      return [{
        id: `lead:${lead.id}`,
        leadId: lead.id,
        empresa: lead.empresa?.trim() || 'Cliente sem nome',
        tipo: 'novo_lead',
        canal: null,
        descricao: 'Lead incluído na base de prospecção.',
        realizadaEm: lead.created_at,
      }]
    })
    const atividadesProspeccao = [...atividadesInteracoes, ...atividadesNovos]
      .sort((a, b) => new Date(b.realizadaEm).getTime() - new Date(a.realizadaEm).getTime() || a.id.localeCompare(b.id))
      .slice(0, 6)

    const novosAtual = novosQ.count ?? 0
    const mensagensAtual = enviadosQ.count ?? 0
    const respostasAtual = respostasQ.count ?? 0
    const oportunidadesAtual = oportunidadesQualificadasQ.count ?? 0
    const novosAnterior = novosAnteriorQ.count ?? 0
    const mensagensAnterior = enviadosAnteriorQ.count ?? 0
    const respostasAnterior = respostasAnteriorQ.count ?? 0
    const oportunidadesAnterior = oportunidadesAnterioresQ.count ?? 0

    return NextResponse.json({
      atualizadoEm: agora.toISOString(),
      visaoProspeccao: {
        modo: escopoResponsavel ? 'individual' : 'equipe',
        podeVerEquipe,
        responsavel: escopoResponsavel ? {
          authId: escopoResponsavel.authId,
          id: escopoResponsavel.id,
          nome: escopoResponsavel.nome,
        } : null,
        responsaveis: podeVerEquipe
          ? (perfisEquipe ?? []).map((perfil) => ({ authId: perfil.id, nome: perfil.nome?.trim() || 'Membro sem nome' }))
          : [],
      },
      operacao,
      antecedenciaDias: antecedencia,
      widgets: habilitados,
      resumo: {
        leads: leadsQ.count ?? 0,
        tarefasAbertas: tarefasQ.count ?? 0,
        oportAbertas: oportQ.count ?? 0,
        pipeline,
        campanhasAtivas: campQ.count ?? 0,
        renovacoesJanela: validades.filter((item) => naJanelaRenovacao(item.vencimentoEm, antecedencia, agora)).length,
        validade,
      },
      prospeccao: {
        novos: novosAtual,
        clientesContatados: contatadosQ.count ?? 0,
        mensagensEnviadas: mensagensAtual,
        respostas: respostasAtual,
        reunioes: reunioesQ.count ?? 0,
        atividades: atividadesProspeccao,
        indicadores: {
          novos: {
            atual: novosAtual,
            anterior: novosAnterior,
            variacao: variacaoPercentual(novosAtual, novosAnterior),
            serie: serieTemporal(leadsMetricas.map((lead) => lead.created_at), desde30, agora),
          },
          mensagens: {
            atual: mensagensAtual,
            anterior: mensagensAnterior,
            variacao: variacaoPercentual(mensagensAtual, mensagensAnterior),
            serie: metricasInteracoes.series.mensagens,
          },
          respostas: {
            atual: respostasAtual,
            anterior: respostasAnterior,
            variacao: variacaoPercentual(respostasAtual, respostasAnterior),
            serie: metricasInteracoes.series.respostas,
          },
          oportunidades: {
            atual: oportunidadesAtual,
            anterior: oportunidadesAnterior,
            variacao: variacaoPercentual(oportunidadesAtual, oportunidadesAnterior),
            serie: serieTemporal(oportunidadesSerie.map((item) => item.criado_em), desde30, agora),
          },
        },
        followUps: metricasInteracoes.followUps,
        nichos: metricasInteracoes.nichos.slice(0, 4),
        respostasPorNichoRegiao: metricasInteracoes.respostasPorNichoRegiao.slice(0, 4),
      },
      renovacoes: {
        renovadosMes: renovadosQ.count ?? 0,
        empresas: empresasVencimento,
        comunicacoes: comunicacoesRenovacao,
        situacoes,
        ciclosRenovados,
        historicoCiclosDisponivel,
      },
      metasAtuais: {
        contatos: contatadosMesQ.count ?? 0,
        reunioes: reunioesMesQ.count ?? 0,
        renovacoes: renovadosQ.count ?? 0,
      },
      vencimentos,
      tarefas: tarefasRows.map((tarefa) => ({
        id: tarefa.id,
        leadId: tarefa.lead_id,
        cliente: tarefa.lead_id ? nomeLead.get(tarefa.lead_id) ?? null : null,
        titulo: tarefa.titulo,
        prioridade: tarefa.prioridade,
        prazoEm: tarefa.prazo_em,
        tipo: tarefa.tipo,
      })),
    })
  } catch (erro) {
    console.error('[dashboard/resumo] falha ao montar painel operacional', erro)
    return NextResponse.json({ erro: 'Não foi possível carregar o painel operacional.' }, { status: 500 })
  }
}
