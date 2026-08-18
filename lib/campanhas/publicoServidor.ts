import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Publico } from '@/components/automacao/tiposCampanha'
import { emailValido } from '@/lib/leads/importarCsv'
import { LIMITE_PUBLICO_CAMPANHA } from './configuracaoGuiada'

export interface LinhaPublicoCampanha {
  id: string
  empresa_id: string | null
  empresa: string | null
  segmento: string | null
  estagio: string | null
  contato_nome: string | null
  contato_email: string | null
  responsavel_id: string | null
  owner: string | null
  optout: boolean | null
  bounced: boolean | null
  perdido: boolean | null
}

interface MarcadoresCliente {
  empresasComServico: Set<string>
  empresasComOportunidadeGanha: Set<string>
  leadsComOportunidadeGanha: Set<string>
}

const COLUNAS_PUBLICO = 'id, empresa_id, empresa, segmento, estagio, contato_nome, contato_email, responsavel_id, owner, optout, bounced, perdido'

export function linhaAtendeCriterioCliente(
  linha: Pick<LinhaPublicoCampanha, 'id' | 'empresa_id' | 'estagio'>,
  criterio: 'clientes' | 'renovacao',
  marcadores: MarcadoresCliente,
): boolean {
  if (linha.empresa_id && marcadores.empresasComServico.has(linha.empresa_id)) return true
  if (criterio === 'renovacao') return false
  return linha.estagio === 'ganho'
    || marcadores.leadsComOportunidadeGanha.has(linha.id)
    || (!!linha.empresa_id && marcadores.empresasComOportunidadeGanha.has(linha.empresa_id))
}

async function buscarMarcadoresCliente(
  admin: SupabaseClient,
  org: string,
  criterio: 'clientes' | 'renovacao',
): Promise<MarcadoresCliente> {
  const [servicos, oportunidades] = await Promise.all([
    admin
      .from('servicos_recorrentes')
      .select('empresa_id')
      .eq('organizacao_id', org)
      .eq('arquivado', false)
      .eq('status', 'vigente')
      .limit(LIMITE_PUBLICO_CAMPANHA),
    criterio === 'clientes'
      ? admin
        .from('oportunidades')
        .select('empresa_id, lead_id')
        .eq('organizacao_id', org)
        .eq('status', 'ganha')
        .limit(LIMITE_PUBLICO_CAMPANHA)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (servicos.error) throw servicos.error
  if (oportunidades.error) throw oportunidades.error
  return {
    empresasComServico: new Set((servicos.data ?? []).map((item) => item.empresa_id as string | null).filter((id): id is string => !!id)),
    empresasComOportunidadeGanha: new Set((oportunidades.data ?? []).map((item) => item.empresa_id as string | null).filter((id): id is string => !!id)),
    leadsComOportunidadeGanha: new Set((oportunidades.data ?? []).map((item) => item.lead_id as string | null).filter((id): id is string => !!id)),
  }
}

export interface PreviaPublicoCampanha {
  totalSelecionado: number
  totalEmpresas: number
  totalEmpresasSelecionadas: number
  emailsValidos: number
  emailsAusentesOuInvalidos: number
  duplicados: number
  bloqueados: number
  semResponsavel: number
  incompativeis: number
  elegiveis: number
  truncado: boolean
  idsElegiveis: string[]
  amostra: { id: string; empresa: string | null; contato: string | null }[]
  empresas: { chave: string; nome: string; segmento: string | null; contatos: number; elegiveis: number; selecionada: boolean }[]
}

export function chaveEmpresaPublico(linha: Pick<LinhaPublicoCampanha, 'empresa_id' | 'empresa'>): string {
  if (linha.empresa_id) return `id:${linha.empresa_id}`
  const nome = linha.empresa?.trim().toLocaleLowerCase('pt-BR') || '__nao_configurado__'
  return `nome:${nome}`
}

function emailNormalizado(valor: string | null): string | null {
  const email = valor?.trim().toLowerCase() ?? ''
  return emailValido(email) ? email : null
}

export function classificarPublicoCampanha(
  linhas: LinhaPublicoCampanha[],
  opts: {
    excluirIds?: string[]
    excluirEmpresas?: string[]
    execucoesIncompativeis?: Set<string>
    limite?: number
    truncado?: boolean
  } = {},
): PreviaPublicoCampanha {
  const excluidos = new Set(opts.excluirIds ?? [])
  const empresasExcluidas = new Set(opts.excluirEmpresas ?? [])
  const execucoes = opts.execucoesIncompativeis ?? new Set<string>()
  const candidatos = linhas.filter((linha) => !excluidos.has(linha.id))
  const selecionados = candidatos.filter((linha) => !empresasExcluidas.has(chaveEmpresaPublico(linha)))
  const ocorrencias = new Map<string, number>()
  for (const linha of selecionados) {
    const email = emailNormalizado(linha.contato_email)
    if (email) ocorrencias.set(email, (ocorrencias.get(email) ?? 0) + 1)
  }

  const usados = new Set<string>()
  const elegiveis: LinhaPublicoCampanha[] = []
  for (const linha of selecionados) {
    const email = emailNormalizado(linha.contato_email)
    const bloqueado = linha.optout === true || linha.bounced === true || linha.perdido === true
    const incompativel = linha.owner !== 'engine' || execucoes.has(linha.id)
    if (!email || bloqueado || incompativel || usados.has(email)) continue
    usados.add(email)
    elegiveis.push(linha)
  }

  const limiteSolicitado = typeof opts.limite === 'number' && opts.limite > 0
    ? Math.min(opts.limite, LIMITE_PUBLICO_CAMPANHA)
    : LIMITE_PUBLICO_CAMPANHA
  const finais = elegiveis.slice(0, limiteSolicitado)
  const idsFinais = new Set(finais.map((linha) => linha.id))
  const empresas = new Map<string, { chave: string; nome: string; segmentos: Set<string>; contatos: number; elegiveis: number; selecionada: boolean }>()
  for (const linha of candidatos) {
    const nome = linha.empresa?.trim() || 'Não configurado'
    const chave = chaveEmpresaPublico(linha)
    const atual = empresas.get(chave) ?? {
      chave,
      nome,
      segmentos: new Set<string>(),
      contatos: 0,
      elegiveis: 0,
      selecionada: !empresasExcluidas.has(chave),
    }
    atual.contatos += 1
    if (linha.segmento?.trim()) atual.segmentos.add(linha.segmento.trim())
    if (idsFinais.has(linha.id)) atual.elegiveis += 1
    empresas.set(chave, atual)
  }
  const listaEmpresas = [...empresas.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(({ segmentos, ...empresa }) => ({
      ...empresa,
      segmento: segmentos.size ? [...segmentos].sort((a, b) => a.localeCompare(b, 'pt-BR')).join(', ') : null,
    }))

  return {
    totalSelecionado: selecionados.length,
    totalEmpresas: empresas.size,
    totalEmpresasSelecionadas: listaEmpresas.filter((empresa) => empresa.selecionada).length,
    emailsValidos: selecionados.filter((linha) => !!emailNormalizado(linha.contato_email)).length,
    emailsAusentesOuInvalidos: selecionados.filter((linha) => !emailNormalizado(linha.contato_email)).length,
    duplicados: [...ocorrencias.values()].reduce((total, quantidade) => total + Math.max(0, quantidade - 1), 0),
    bloqueados: selecionados.filter((linha) => linha.optout === true || linha.bounced === true || linha.perdido === true).length,
    semResponsavel: selecionados.filter((linha) => !linha.responsavel_id).length,
    incompativeis: selecionados.filter((linha) => linha.owner !== 'engine' || execucoes.has(linha.id)).length,
    elegiveis: finais.length,
    truncado: opts.truncado === true || elegiveis.length > limiteSolicitado,
    idsElegiveis: finais.map((linha) => linha.id),
    amostra: finais.slice(0, 5).map((linha) => ({
      id: linha.id,
      empresa: linha.empresa,
      contato: linha.contato_nome,
    })),
    empresas: listaEmpresas,
  }
}

export async function buscarPreviaPublicoCampanha(
  admin: SupabaseClient,
  org: string,
  publico: Publico,
  workflowId?: string | null,
): Promise<PreviaPublicoCampanha> {
  const selecao = publico.selecao ?? {}
  const idsManuais = (selecao.leadIds ?? []).slice(0, LIMITE_PUBLICO_CAMPANHA)
  const criterioCliente = selecao.criterio === 'clientes' || selecao.criterio === 'renovacao'
    ? selecao.criterio
    : null
  const marcadoresCliente = criterioCliente
    ? await buscarMarcadoresCliente(admin, org, criterioCliente)
    : null
  let todas: LinhaPublicoCampanha[] = []
  let truncadoConsulta = false
  if (selecao.modo === 'manual') {
    if (!idsManuais.length) return classificarPublicoCampanha([])
    for (let i = 0; i < idsManuais.length; i += 200) {
      let query = admin
        .from('leads')
        .select(COLUNAS_PUBLICO)
        .eq('organizacao_id', org)
        .in('id', idsManuais.slice(i, i + 200))
        .order('id', { ascending: true })
      if (selecao.estagios?.length) query = query.in('estagio', selecao.estagios)
      const { data, error } = await query
      if (error) throw error
      todas.push(...((data ?? []) as LinhaPublicoCampanha[]))
    }
    if (criterioCliente && marcadoresCliente) {
      todas = todas.filter((linha) => linhaAtendeCriterioCliente(linha, criterioCliente, marcadoresCliente))
    }
  } else {
    let query = admin
      .from('leads')
      .select(COLUNAS_PUBLICO)
      .eq('organizacao_id', org)
      .order('id', { ascending: true })
      .limit(LIMITE_PUBLICO_CAMPANHA + 1)
    const segmento = publico.empresas?.segmento?.trim()
    if (segmento) query = query.eq('segmento', segmento)
    if (!criterioCliente && selecao.estagios?.length) query = query.in('estagio', selecao.estagios)
    const { data, error } = await query
    if (error) throw error
    todas = (data ?? []) as LinhaPublicoCampanha[]
    truncadoConsulta = todas.length > LIMITE_PUBLICO_CAMPANHA
    if (criterioCliente && marcadoresCliente) {
      todas = todas.filter((linha) => linhaAtendeCriterioCliente(linha, criterioCliente, marcadoresCliente))
    }
  }
  const linhas = todas.slice(0, LIMITE_PUBLICO_CAMPANHA)

  const execucoesIncompativeis = new Set<string>()
  const ids = linhas.map((linha) => linha.id)
  for (let i = 0; i < ids.length; i += 200) {
    let execQuery = admin
      .from('workflow_execucoes')
      .select('lead_id, workflow_id')
      .eq('organizacao_id', org)
      .in('lead_id', ids.slice(i, i + 200))
      .in('status', ['em_andamento', 'aguardando'])
    if (workflowId) execQuery = execQuery.neq('workflow_id', workflowId)
    const { data: execucoes, error: execError } = await execQuery
    if (execError) throw execError
    for (const execucao of execucoes ?? []) {
      if (execucao.lead_id) execucoesIncompativeis.add(execucao.lead_id as string)
    }
  }

  return classificarPublicoCampanha(linhas, {
    excluirIds: selecao.excluirLeadIds,
    excluirEmpresas: selecao.excluirEmpresas,
    execucoesIncompativeis,
    limite: publico.empresas?.limite,
    truncado: truncadoConsulta,
  })
}

export function previaParaCliente(previa: PreviaPublicoCampanha) {
  const { idsElegiveis: _ids, ...segura } = previa
  return segura
}
