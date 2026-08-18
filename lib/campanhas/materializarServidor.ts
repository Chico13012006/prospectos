import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MensagemCampanha, Publico } from '@/components/automacao/tiposCampanha'
import { atualizarCampanha } from './repository'
import {
  corpoComLink,
  montarDefinicaoCampanha,
  normalizarPublicoCampanha,
  tipoTemplateCampanha,
} from './configuracaoGuiada'
import { criarWorkflow, salvarRascunho, SupabaseWorkflowStore } from '@/lib/workflows'
import { buscarRemetenteCampanha } from './opcoesServidor'

interface Materializacao {
  publico: Publico
  workflowId: string | null
}

async function materializarTemplate(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  campanhaNome: string,
  mensagem: MensagemCampanha,
  indice: number,
): Promise<MensagemCampanha> {
  if (!mensagem.assunto?.trim() || !mensagem.corpo?.trim()) return mensagem

  const tipo = tipoTemplateCampanha(campanhaId, indice)
  const valores = {
    nome: `${campanhaNome} — mensagem ${indice + 1}`,
    tipo,
    canal: 'email',
    nicho: null,
    assunto: mensagem.assunto.trim(),
    corpo: corpoComLink(mensagem),
    ativo: true,
  }

  let templateId: string | null = null
  if (mensagem.templateId) {
    const { data, error } = await admin
      .from('templates')
      .update(valores)
      .eq('organizacao_id', org)
      .eq('id', mensagem.templateId)
      .select('id')
      .maybeSingle()
    if (error) throw error
    templateId = (data as { id?: string } | null)?.id ?? null
  }

  if (!templateId) {
    const { data: existente, error: buscaErro } = await admin
      .from('templates')
      .select('id')
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', tipo)
      .is('nicho', null)
      .limit(1)
      .maybeSingle()
    if (buscaErro) throw buscaErro

    if (existente?.id) {
      const { error } = await admin
        .from('templates')
        .update(valores)
        .eq('organizacao_id', org)
        .eq('id', existente.id)
      if (error) throw error
      templateId = existente.id as string
    } else {
      const { data, error } = await admin
        .from('templates')
        .insert({ ...valores, organizacao_id: org })
        .select('id')
        .single()
      if (error) throw error
      templateId = data.id as string
    }
  }

  return { ...mensagem, templateId, templateTipo: tipo }
}

// Transforma a edição amigável em templates e rascunho versionável. Só toca no
// workflow criado para esta campanha; workflows escolhidos no modo avançado não
// são reinterpretados nem sobrescritos.
export async function materializarCampanhaGuiada(
  admin: SupabaseClient,
  org: string,
  campanhaId: string,
  campanhaNome: string,
  bruto: unknown,
): Promise<Materializacao> {
  const normalizado = normalizarPublicoCampanha(bruto)
  const remetente = await buscarRemetenteCampanha(admin, org)
  const publico: Publico = {
    ...normalizado,
    operacao: {
      ...normalizado.operacao,
      remetenteConta: remetente?.conta,
      remetenteEmail: remetente?.email,
    },
  }
  const inicial = publico.operacao?.mensagemInicial
  if (!inicial?.assunto || !inicial.corpo) {
    await atualizarCampanha(admin, org, campanhaId, { publico })
    return { publico, workflowId: null }
  }

  const mensagens = [inicial, ...(publico.operacao?.followups ?? [])]
  const materializadas: MensagemCampanha[] = []
  for (const [indice, mensagem] of mensagens.entries()) {
    materializadas.push(await materializarTemplate(admin, org, campanhaId, campanhaNome, mensagem, indice))
  }

  const store = new SupabaseWorkflowStore(org, admin)
  const workflowGerenciadoId = publico.operacao?.workflowGerenciadoId
  let workflowId: string
  if (workflowGerenciadoId) {
    const existente = await store.buscarWorkflow(workflowGerenciadoId)
    if (!existente) throw new Error('O workflow gerenciado desta campanha não foi encontrado.')
    workflowId = existente.id
  } else {
    const novo = await criarWorkflow(store, { nome: `Campanha — ${campanhaNome}` })
    workflowId = novo.id
  }

  const materializado: Publico = {
    ...publico,
    operacao: {
      ...publico.operacao,
      mensagemInicial: materializadas[0],
      followups: materializadas.slice(1).map((mensagem, indice) => ({
        ...mensagem,
        diasApos: publico.operacao?.followups?.[indice]?.diasApos,
      })),
      workflowGerenciadoId: workflowId,
    },
  }
  await salvarRascunho(store, workflowId, montarDefinicaoCampanha(materializado))
  await atualizarCampanha(admin, org, campanhaId, { publico: materializado, workflow_id: workflowId })
  return { publico: materializado, workflowId }
}
