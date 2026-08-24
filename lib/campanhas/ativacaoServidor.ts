import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { atualizarCampanha, buscarCampanha } from './repository'
import { materializarCampanhaGuiada } from './materializarServidor'
import {
  LIMITE_CONFIRMACAO_CAMPANHA,
  aplicarRegraPublicoPorTipo,
  validarCampanhaGuiada,
} from './configuracaoGuiada'
import { buscarPreviaPublicoCampanha } from './publicoServidor'
import { exigirEnvioRealCampanhaDisponivel } from './opcoesServidor'
import {
  inscreverLeadManual,
  publicar,
  retomar,
  SupabaseWorkflowStore,
} from '@/lib/workflows'

interface ResultadoAtivacao {
  campanha_id: string
  workflow_id: string
  dry_run: true
  publico: number
}

interface ResultadoEnrollmentReal {
  campanha_id: string
  workflow_id: string
  dry_run: false
  publico: number
  inscritos: number
  ja_inscritos: number
  falhas: number
  execucoes_criadas: string[]
}

export async function ativarCampanhaGuiada(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  autorId: string,
  confirmarQuantidade?: number,
): Promise<ResultadoAtivacao> {
  const campanha = await buscarCampanha(admin, org, campanhaId)
  if (!campanha) throw new Error('Campanha não encontrada.')
  if (campanha.status === 'concluida') throw new Error('Uma campanha concluída não pode ser reativada.')
  if (campanha.dry_run !== true) {
    throw new Error('A ativação guiada é permitida somente em modo de simulação.')
  }

  const materializada = await materializarCampanhaGuiada(
    admin,
    org,
    campanhaId,
    campanha.nome,
    aplicarRegraPublicoPorTipo(campanha.publico, campanha.tipo),
  )
  const erros = validarCampanhaGuiada(materializada.publico)
  if (erros.length) throw new Error(erros.join(' '))
  if (!materializada.workflowId) throw new Error('A campanha ainda não tem uma cadência configurada.')

  const previa = await buscarPreviaPublicoCampanha(
    admin,
    org,
    materializada.publico,
    materializada.workflowId,
  )
  if (!previa.elegiveis) throw new Error('Nenhum contato elegível foi encontrado para esta campanha.')
  if (
    previa.elegiveis > LIMITE_CONFIRMACAO_CAMPANHA
    && confirmarQuantidade !== previa.elegiveis
  ) {
    throw new Error(`Confirme explicitamente a quantidade atual de ${previa.elegiveis} contatos.`)
  }

  const store = new SupabaseWorkflowStore(org, admin)
  const workflow = await store.buscarWorkflow(materializada.workflowId)
  if (!workflow) throw new Error('Workflow da campanha não encontrado.')
  if (workflow.rascunho_definicao) {
    await publicar(store, workflow.id, autorId)
  } else if (workflow.status === 'pausado') {
    await retomar(store, workflow.id)
  } else if (workflow.status !== 'publicado') {
    throw new Error('O workflow da campanha ainda não pode ser publicado.')
  }

  if (campanha.status === 'rascunho' || campanha.status === 'pausada') {
    await atualizarCampanha(admin, org, campanhaId, { status: 'ativa' })
  }

  return {
    campanha_id: campanhaId,
    workflow_id: workflow.id,
    dry_run: true,
    publico: previa.elegiveis,
  }
}

// O enrollment real é uma ação separada e explicitamente confirmada. Assim,
// publicar/revisar em dry-run não cria nem avança execuções persistentes.
export async function inscreverCampanhaReal(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  confirmarQuantidade?: number,
): Promise<ResultadoEnrollmentReal> {
  await exigirEnvioRealCampanhaDisponivel(admin, org)
  const campanha = await buscarCampanha(admin, org, campanhaId)
  if (!campanha) throw new Error('Campanha não encontrada.')
  if (campanha.status !== 'ativa') throw new Error('Ative a campanha em modo ensaio antes do envio real.')
  if (!campanha.workflow_id) throw new Error('Campanha sem workflow vinculado.')

  const previa = await buscarPreviaPublicoCampanha(
    admin,
    org,
    aplicarRegraPublicoPorTipo(campanha.publico, campanha.tipo),
    campanha.workflow_id,
  )
  if (!previa.elegiveis) throw new Error('Nenhum contato elegível foi encontrado para esta campanha.')
  if (confirmarQuantidade !== previa.elegiveis) {
    throw new Error(`Confirme explicitamente a quantidade atual de ${previa.elegiveis} contatos.`)
  }

  const store = new SupabaseWorkflowStore(org, admin)
  const workflow = await store.buscarWorkflow(campanha.workflow_id)
  if (!workflow || workflow.status !== 'publicado' || !workflow.versao_atual_id) {
    throw new Error('O workflow da campanha precisa estar publicado antes do envio real.')
  }

  // Só sai do dry-run depois de público e workflow terem sido revalidados.
  if (campanha.dry_run !== false) {
    await atualizarCampanha(admin, org, campanhaId, { dry_run: false })
  }

  let inscritos = 0
  let jaInscritos = 0
  let falhas = 0
  const execucoesProcessaveis: string[] = []
  for (const leadId of previa.idsElegiveis) {
    try {
      const resultado = await inscreverLeadManual(store, workflow.id, leadId, campanhaId)
      if (resultado.jaInscrito) jaInscritos += 1
      else {
        inscritos += 1
      }
      if (resultado.execucaoId) execucoesProcessaveis.push(resultado.execucaoId)
    } catch {
      falhas += 1
    }
  }

  if (falhas > 0 && inscritos + jaInscritos === 0) {
    await atualizarCampanha(admin, org, campanhaId, { dry_run: true })
    throw new Error('Nenhum contato pôde ser inscrito; o modo ensaio foi mantido.')
  }

  return {
    campanha_id: campanhaId,
    workflow_id: workflow.id,
    dry_run: false,
    publico: previa.elegiveis,
    inscritos,
    ja_inscritos: jaInscritos,
    falhas,
    execucoes_criadas: execucoesProcessaveis,
  }
}

// Jornada direta do wizard: publica uma versão imutável ainda protegida por
// dry-run e, somente depois dessa validação, desativa o ensaio e cria as
// execuções da seleção confirmada. Se o enrollment falhar, a ativação anterior
// permanece segura em dry-run; nenhum envio é executado dentro desta requisição.
export async function iniciarCampanhaReal(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  autorId: string,
  confirmarQuantidade?: number,
): Promise<ResultadoEnrollmentReal> {
  if (!Number.isInteger(confirmarQuantidade) || (confirmarQuantidade ?? 0) <= 0) {
    throw new Error('Confirme explicitamente a quantidade atual de contatos elegíveis.')
  }

  await exigirEnvioRealCampanhaDisponivel(admin, org)
  await ativarCampanhaGuiada(admin, org, campanhaId, autorId, confirmarQuantidade)
  return inscreverCampanhaReal(admin, org, campanhaId, confirmarQuantidade)
}
