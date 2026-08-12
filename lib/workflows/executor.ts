// Executor do motor de workflows (Fase 3). Duas responsabilidades:
//
//  1) ENROLLMENT: para cada workflow publicado, avalia o gatilho e inscreve os
//     leads-alvo que ainda não têm execução (idempotente).
//  2) STEPPING: avança cada execução pendente. Gate de condições (AND) no início;
//     depois roda as ações em ordem. A ação 'esperar' SUSPENDE a execução
//     (status='aguardando' + proxima_verificacao_em) e o poll a retoma no MESMO
//     passo depois — a espera é PERSISTIDA (vive no banco), então sobrevive a
//     reinício do processo. `passo_atual` garante que cada ação roda uma vez
//     (semântica at-least-once: se cair entre efeito e persistência, a ação pode
//     repetir no resume — tradeoff documentado, aceitável para esta v1).
//
// Sem fila em memória e sem pg-boss: é o mesmo padrão poll-por-timestamp que o
// leadsParaFollowup() do motor de cadência já usa, rodando no cron.
import type { WorkflowStore } from './store/store'
import type { CtxExec, RegistroWorkflows } from './registro'
import type { AmbienteWorkflow } from './ambiente'
import type { DefinicaoWorkflow } from './types'

function ctxDe(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  execucao: import('./types').WorkflowExecucao,
  config: Record<string, unknown>,
): CtxExec {
  return {
    ambiente,
    store,
    registro,
    execucao,
    leadId: execucao.lead_id,
    config,
    log: (tipo, detalhe) => store.registrarEvento({ execucao_id: execucao.id, tipo, detalhe: detalhe ?? null }),
  }
}

async function definicaoDaExecucao(store: WorkflowStore, versaoId: string): Promise<DefinicaoWorkflow> {
  const versao = await store.buscarVersao(versaoId)
  if (!versao) throw new Error(`versão ${versaoId} da execução não encontrada`)
  return versao.definicao
}

// Avança UMA execução o quanto der até concluir ou bater numa espera.
export async function processarExecucao(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  execucaoId: string,
  agoraISO: string = new Date().toISOString(),
): Promise<void> {
  const ex = await store.buscarExecucao(execucaoId)
  if (!ex) return
  if (ex.status === 'concluido' || ex.status === 'erro' || ex.status === 'cancelado') return
  // Espera ainda não venceu → não toca.
  if (ex.status === 'aguardando') {
    if (!ex.proxima_verificacao_em || new Date(ex.proxima_verificacao_em).getTime() > new Date(agoraISO).getTime()) return
  }

  const log = (tipo: string, detalhe?: Record<string, unknown>) =>
    store.registrarEvento({ execucao_id: ex.id, tipo, detalhe: detalhe ?? null })

  try {
    const def = await definicaoDaExecucao(store, ex.versao_id)

    // Gate de condições — só na primeira passada (passo_atual === 0), antes de
    // qualquer ação. Em resume (passo > 0) as condições não são reavaliadas.
    if (ex.passo_atual === 0) {
      for (const cond of def.condicoes ?? []) {
        const passou = await registro.obterCondicao(cond.tipo).avaliar(ctxDe(store, registro, ambiente, ex, cond.config ?? {}))
        if (!passou) {
          await log('condicoes_nao_satisfeitas', { condicao: cond.tipo })
          await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
          return
        }
      }
    }

    // Pipeline de ações. `passo_atual` NÃO é só +1: uma ação pode saltar
    // (ramificação) ou encerrar. Trava anti-laço: um salto para trás sem espera
    // no meio geraria loop infinito dentro de um único tick — o contador corta.
    const totalAcoes = def.acoes?.length ?? 0
    const MAX_PASSOS = totalAcoes * 100 + 100
    let passo = ex.passo_atual
    let voltas = 0
    while (passo < totalAcoes) {
      if (voltas++ > MAX_PASSOS)
        throw new Error(`limite de passos excedido (${MAX_PASSOS}) — possível laço de ramificação`)

      const bloco = def.acoes[passo]
      const res = await registro.obterAcao(bloco.tipo).executar(ctxDe(store, registro, ambiente, ex, bloco.config ?? {}))
      await log('acao_executada', { passo, acao: bloco.tipo })

      if (res.tipo === 'esperar') {
        await store.atualizarExecucao(ex.id, {
          passo_atual: passo + 1, // retoma DEPOIS da espera
          status: 'aguardando',
          proxima_verificacao_em: res.ate,
          atualizado_em: agoraISO,
        })
        await log('aguardando', { ate: res.ate })
        return
      }

      if (res.tipo === 'encerrar') {
        await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
        await log('encerrado', { passo })
        return
      }

      // saltar: resolve o id do passo alvo → índice ATUAL (referência estável a
      // reordenar/remover). continuar: próximo passo. Persiste passo_atual sempre,
      // para o resume (at-least-once) retomar do lugar certo se cair aqui.
      if (res.tipo === 'saltar') {
        const alvo = (def.acoes ?? []).findIndex((a) => a.id === res.destinoId)
        if (alvo < 0) throw new Error(`saltar_se: passo destino '${res.destinoId}' não existe na definição`)
        passo = alvo
        await log('saltou', { destinoId: res.destinoId, para: alvo })
      } else {
        passo += 1
      }
      await store.atualizarExecucao(ex.id, { passo_atual: passo, status: 'em_andamento', atualizado_em: agoraISO })
    }

    await store.atualizarExecucao(ex.id, { status: 'concluido', atualizado_em: agoraISO })
    await log('concluido')
  } catch (e) {
    await store.atualizarExecucao(ex.id, { status: 'erro', atualizado_em: agoraISO })
    await log('erro', { mensagem: e instanceof Error ? e.message : String(e) })
  }
}

// Inscreve leads-alvo dos workflows publicados (idempotente).
export async function processarEnrollment(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
): Promise<number> {
  let inscritos = 0
  for (const wf of await store.workflowsPublicados()) {
    if (!wf.versao_atual_id) continue
    const versao = await store.buscarVersao(wf.versao_atual_id)
    if (!versao) continue
    const gatilho = versao.definicao.gatilho
    const alvos = await registro.obterGatilho(gatilho.tipo).selecionarAlvos({ ambiente, config: gatilho.config ?? {} })
    for (const leadId of alvos) {
      if (await store.existeExecucaoParaLead(wf.id, leadId)) continue
      const ex = await store.criarExecucao({ workflow_id: wf.id, versao_id: wf.versao_atual_id, lead_id: leadId })
      await store.registrarEvento({
        execucao_id: ex.id,
        tipo: 'execucao_iniciada',
        detalhe: { versao_id: ex.versao_id, lead_id: leadId, via: 'enrollment' },
      })
      inscritos += 1
    }
  }
  return inscritos
}

// Inscreve UM lead específico num workflow SOB DEMANDA (gatilho 'manual' ou botão
// "Inscrever agora"), sem esperar o poll. Mesma lógica de processarEnrollment
// (criarExecucao + evento execucao_iniciada), idempotente por lead. O stepping
// segue sendo do poll. Exige workflow publicado (fixa a versão vigente).
// campanhaId: quando o enrollment vem de uma campanha, grava o vínculo na execução
// (usado pelo ambiente para verificar campanhas.dry_run antes de enviar e-mail).
export async function inscreverLeadManual(
  store: WorkflowStore,
  workflowId: string,
  leadId: string,
  campanhaId?: string | null,
): Promise<{ jaInscrito: boolean; execucaoId?: string }> {
  const wf = await store.buscarWorkflow(workflowId)
  if (!wf) throw new Error(`workflow ${workflowId} não encontrado`)
  if (wf.status !== 'publicado' || !wf.versao_atual_id)
    throw new Error('workflow precisa estar publicado para inscrever um lead manualmente.')
  if (await store.existeExecucaoParaLead(workflowId, leadId)) return { jaInscrito: true }
  const ex = await store.criarExecucao({
    workflow_id: workflowId,
    versao_id: wf.versao_atual_id,
    lead_id: leadId,
    campanha_id: campanhaId ?? null,
  })
  await store.registrarEvento({
    execucao_id: ex.id,
    tipo: 'execucao_iniciada',
    detalhe: { versao_id: ex.versao_id, lead_id: leadId, via: campanhaId ? 'campanha' : 'manual' },
  })
  return { jaInscrito: false, execucaoId: ex.id }
}

// Um "tick" completo do poll para UMA organização (o store já é org-scoped):
// inscreve novos e avança todas as execuções pendentes.
export async function processarTudo(
  store: WorkflowStore,
  registro: RegistroWorkflows,
  ambiente: AmbienteWorkflow,
  agoraISO: string = new Date().toISOString(),
): Promise<{ inscritos: number; processadas: number }> {
  const inscritos = await processarEnrollment(store, registro, ambiente)
  const pendentes = await store.execucoesPendentes(agoraISO)
  for (const ex of pendentes) await processarExecucao(store, registro, ambiente, ex.id, agoraISO)
  return { inscritos, processadas: pendentes.length }
}
