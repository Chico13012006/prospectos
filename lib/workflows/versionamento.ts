// Versionamento de workflows (Fase 2). Regras (do prompt-guia):
//
//  - Editar um workflow PUBLICADO nunca sobrescreve a versão publicada: grava
//    em `rascunho_definicao` até o "Publicar".
//  - "Publicar" cria uma linha NOVA e IMUTÁVEL em workflow_versoes (numero++) e
//    só então aponta workflows.versao_atual_id para ela.
//  - Uma execução fixa `versao_id` na criação e NUNCA migra de versão, mesmo se
//    o workflow for republicado no meio do caminho.
//  - Pausar impede NOVAS execuções de iniciar; não mexe nas em andamento.
//
// São funções puras sobre um WorkflowStore (testáveis com MemoryStore).
import type { DefinicaoWorkflow, Workflow, WorkflowExecucao, WorkflowVersao } from './types'
import type { WorkflowStore } from './store/store'

const agora = () => new Date().toISOString()

// Validação estrutural mínima do grafo (a semântica dos tipos é da Fase 3).
// Falha ALTO na publicação se o rascunho estiver malformado.
export function validarDefinicao(def: DefinicaoWorkflow | null | undefined): asserts def is DefinicaoWorkflow {
  if (!def || typeof def !== 'object') throw new Error('Definição do workflow ausente.')
  if (!def.gatilho || typeof def.gatilho.tipo !== 'string' || !def.gatilho.tipo)
    throw new Error('Workflow precisa de um gatilho com `tipo`.')
  if (!Array.isArray(def.condicoes)) throw new Error('`condicoes` deve ser uma lista.')
  if (!Array.isArray(def.acoes) || def.acoes.length === 0)
    throw new Error('Workflow precisa de ao menos uma ação.')
  for (const b of [...def.condicoes, ...def.acoes])
    if (!b || typeof b.tipo !== 'string' || !b.tipo)
      throw new Error('Todo bloco (condição/ação) precisa de `tipo`.')
}

// Cria um workflow novo, sempre em rascunho e sem versão publicada.
export async function criarWorkflow(
  store: WorkflowStore,
  input: { nome: string; definicao?: DefinicaoWorkflow | null },
): Promise<Workflow> {
  if (!input.nome?.trim()) throw new Error('Workflow precisa de um nome.')
  return store.criarWorkflow({ nome: input.nome.trim(), rascunho_definicao: input.definicao ?? null })
}

// Salva o rascunho de edição. Vale em qualquer status: editar um workflow
// publicado só atualiza o rascunho — NÃO toca na versão publicada nem no
// versao_atual_id (as execuções em andamento seguem intactas).
export async function salvarRascunho(
  store: WorkflowStore,
  workflowId: string,
  definicao: DefinicaoWorkflow,
): Promise<Workflow> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  await store.atualizarWorkflow(workflowId, { rascunho_definicao: definicao, atualizado_em: agora() })
  return { ...wf, rascunho_definicao: definicao }
}

// Publica o rascunho atual: congela uma nova versão imutável e a torna vigente.
export async function publicar(
  store: WorkflowStore,
  workflowId: string,
  publicadoPor?: string | null,
): Promise<{ workflow: Workflow; versao: WorkflowVersao }> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  const def = wf.rascunho_definicao
  validarDefinicao(def) // lança se não houver rascunho ou estiver malformado

  const numero = await store.proximoNumeroVersao(workflowId)
  const versao = await store.criarVersao({
    workflow_id: workflowId,
    numero,
    definicao: def,
    publicado_por: publicadoPor ?? null,
  })

  // Só depois de a versão existir é que o cabeçalho passa a apontá-la. Zera o
  // rascunho: não há mais alterações pendentes (a próxima edição recria o rascunho).
  await store.atualizarWorkflow(workflowId, {
    versao_atual_id: versao.id,
    status: 'publicado',
    rascunho_definicao: null,
    atualizado_em: agora(),
  })

  return { workflow: { ...wf, versao_atual_id: versao.id, status: 'publicado', rascunho_definicao: null }, versao }
}

// Pausa um workflow publicado: impede NOVAS execuções (ver iniciarExecucao).
// Não cancela execuções em andamento (decisão documentada no prompt-guia).
export async function pausar(store: WorkflowStore, workflowId: string): Promise<Workflow> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  if (wf.status !== 'publicado') throw new Error(`só é possível pausar um workflow publicado (status atual: ${wf.status}).`)
  await store.atualizarWorkflow(workflowId, { status: 'pausado', atualizado_em: agora() })
  return { ...wf, status: 'pausado' }
}

// Retoma um workflow pausado (volta a 'publicado').
export async function retomar(store: WorkflowStore, workflowId: string): Promise<Workflow> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  if (wf.status !== 'pausado') throw new Error(`só é possível retomar um workflow pausado (status atual: ${wf.status}).`)
  await store.atualizarWorkflow(workflowId, { status: 'publicado', atualizado_em: agora() })
  return { ...wf, status: 'publicado' }
}

// Inicia uma execução FIXANDO a versão vigente. Aqui na Fase 2 só cria a linha e
// registra o evento de início — o stepping (avaliar gatilho/condições, rodar
// ações, esperar) é da Fase 3. Serve para provar a invariante de versionamento:
// republicar depois NÃO muda o versao_id desta execução.
export async function iniciarExecucao(
  store: WorkflowStore,
  workflowId: string,
  input: { leadId?: string | null } = {},
): Promise<WorkflowExecucao> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  if (wf.status !== 'publicado')
    throw new Error(`workflow não está publicado (status: ${wf.status}) — não inicia execução.`)
  if (!wf.versao_atual_id) throw new Error('workflow publicado sem versao_atual_id — estado inconsistente.')

  const execucao = await store.criarExecucao({
    workflow_id: workflowId,
    versao_id: wf.versao_atual_id, // FIXA aqui — nunca muda depois
    lead_id: input.leadId ?? null,
  })
  await store.registrarEvento({
    execucao_id: execucao.id,
    tipo: 'execucao_iniciada',
    detalhe: { versao_id: execucao.versao_id, lead_id: execucao.lead_id },
  })
  return execucao
}
