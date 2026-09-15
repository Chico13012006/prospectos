import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig } from '@/lib/config/workspaceConfig'
import { motivoBloqueioExclusao } from './exclusao'

// Exclusão definitiva de uma campanha pela interface. Leva junto o que a
// campanha gerou por baixo e ninguém mais usa: execuções, eventos e o workflow
// interno com as versões publicadas. service_role ignora RLS, então toda
// leitura e escrita filtra organizacao_id explicitamente.
//
// Preserva o que pertence ao lead: leads, interações, tarefas e templates —
// `interacoes.template_id` aponta para o template enviado, e apagá-lo desfaria
// esse vínculo no histórico.
//
// A linha da campanha sai por ÚLTIMO: se algo falhar no meio, a campanha segue
// na lista e a exclusão pode ser repetida (apagar o que já saiu não faz nada).

export class ErroExclusaoCampanha extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message)
    this.name = 'ErroExclusaoCampanha'
  }
}

export interface ResultadoExclusaoCampanha {
  execucoes: number
  eventos: number
  workflowApagado: boolean
}

interface CampanhaExclusao {
  id: string
  status: string
  workflow_id: string | null
}

interface ExecucaoExclusao {
  id: string
  status: string
  campanha_id: string | null
}

// PostgREST devolve no máximo 1000 linhas; ids vão em lotes para o `in(...)`
// não estourar o tamanho da URL.
const PAGINA = 1000
const LOTE_IDS = 150

async function lerExecucoes(
  admin: SupabaseClient,
  org: string,
  coluna: 'campanha_id' | 'workflow_id',
  valor: string,
): Promise<ExecucaoExclusao[]> {
  const linhas: ExecucaoExclusao[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from('workflow_execucoes')
      .select('id, status, campanha_id')
      .eq('organizacao_id', org)
      .eq(coluna, valor)
      .order('id')
      .range(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    linhas.push(...((data ?? []) as ExecucaoExclusao[]))
    if (!data || data.length < PAGINA) return linhas
  }
}

async function apagarPorIds(
  admin: SupabaseClient,
  org: string,
  tabela: 'workflow_execucao_eventos' | 'workflow_execucoes',
  coluna: 'execucao_id' | 'id',
  ids: string[],
): Promise<number> {
  let total = 0
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { error, count } = await admin
      .from(tabela)
      .delete({ count: 'exact' })
      .eq('organizacao_id', org)
      .in(coluna, ids.slice(i, i + LOTE_IDS))
    if (error) throw new Error(error.message)
    total += count ?? 0
  }
  return total
}

export async function apagarCampanha(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
): Promise<ResultadoExclusaoCampanha> {
  const { data, error } = await admin
    .from('campanhas')
    .select('id, status, workflow_id')
    .eq('organizacao_id', org)
    .eq('id', campanhaId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const campanha = data as CampanhaExclusao | null
  if (!campanha) throw new ErroExclusaoCampanha('Campanha não encontrada.', 404)

  const execucoes = await lerExecucoes(admin, org, 'campanha_id', campanha.id)
  const pendentes = execucoes.filter((e) => e.status === 'em_andamento' || e.status === 'aguardando').length
  const bloqueio = motivoBloqueioExclusao(campanha.status, pendentes)
  if (bloqueio) throw new ErroExclusaoCampanha(bloqueio, 409)

  const { data: orgRow, error: erroOrg } = await admin
    .from('organizacoes')
    .select('configuracoes')
    .eq('id', org)
    .maybeSingle()
  if (erroOrg) throw new Error(erroOrg.message)
  if (parseWorkspaceConfig(orgRow?.configuracoes).comercial?.campanhaRetornoId === campanha.id) {
    throw new ErroExclusaoCampanha(
      'Esta é a campanha de retorno do handoff comercial. Troque-a em Configurações antes de apagar.',
      409,
    )
  }

  // Só apaga o workflow exclusivo desta campanha: se outra campanha ou alguma
  // execução de fora dela o usa, ele fica.
  let apagarWorkflow = false
  if (campanha.workflow_id) {
    const { data: outras, error: erroOutras } = await admin
      .from('campanhas')
      .select('id')
      .eq('organizacao_id', org)
      .eq('workflow_id', campanha.workflow_id)
      .neq('id', campanha.id)
      .limit(1)
    if (erroOutras) throw new Error(erroOutras.message)
    const doWorkflow = await lerExecucoes(admin, org, 'workflow_id', campanha.workflow_id)
    apagarWorkflow = !outras?.length && doWorkflow.every((e) => e.campanha_id === campanha.id)
  }

  const idsExecucao = execucoes.map((e) => e.id)
  const eventos = await apagarPorIds(admin, org, 'workflow_execucao_eventos', 'execucao_id', idsExecucao)
  const totalExecucoes = await apagarPorIds(admin, org, 'workflow_execucoes', 'id', idsExecucao)

  if (campanha.workflow_id && apagarWorkflow) {
    // FK circular workflows.versao_atual_id → workflow_versoes (0008), não
    // adiável: solta o ponteiro antes de apagar as versões.
    const { error: erroPonteiro } = await admin
      .from('workflows')
      .update({ versao_atual_id: null })
      .eq('organizacao_id', org)
      .eq('id', campanha.workflow_id)
    if (erroPonteiro) throw new Error(erroPonteiro.message)
    const { error: erroVersoes } = await admin
      .from('workflow_versoes')
      .delete()
      .eq('organizacao_id', org)
      .eq('workflow_id', campanha.workflow_id)
    if (erroVersoes) throw new Error(erroVersoes.message)
    const { error: erroWorkflow } = await admin
      .from('workflows')
      .delete()
      .eq('organizacao_id', org)
      .eq('id', campanha.workflow_id)
    if (erroWorkflow) throw new Error(erroWorkflow.message)
  }

  const { error: erroCampanha } = await admin
    .from('campanhas')
    .delete()
    .eq('organizacao_id', org)
    .eq('id', campanha.id)
  if (erroCampanha) throw new Error(erroCampanha.message)

  return { execucoes: totalExecucoes, eventos, workflowApagado: apagarWorkflow }
}
