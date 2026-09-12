import type { SupabaseClient } from '@supabase/supabase-js'
import { diasAteVencimento } from '@/lib/servicos/vencimento'

// Ciclos de validade do laudo de um lead (tabela laudo_ciclos, migration 0039).
//
// Regra de negócio:
//   * Vigente / Próximo do vencimento / Vencido descrevem o CICLO ATUAL e são
//     CALCULADOS pela data — nunca gravados.
//   * Renovado descreve um CICLO HISTÓRICO, encerrado por renovação.
//   * Depois de renovar, o lead NÃO fica "renovado": o ciclo antigo vira
//     histórico e o novo assume vigente/próximo/vencido pela nova data.
//
// Dois caminhos de escrita, com semânticas diferentes:
//   renovarLaudo()          — encerra o ciclo atual, preserva no histórico,
//                             abre o próximo e espelha em leads.data_validade.
//   sincronizarCicloAtual() — correção manual / importação: muda a validade do
//                             ciclo atual (ou cria o primeiro). Não é renovação.
//
// `leads.data_validade` continua a fonte que cron, workflows e dashboard leem;
// esta tabela é o histórico ao lado. Todo acesso é escopado por organizacao_id.

export type StatusLaudo = 'vigente' | 'proximo_vencimento' | 'vencido' | 'renovado'

export const ROTULO_STATUS_LAUDO: Record<StatusLaudo, string> = {
  vigente: 'Vigente',
  proximo_vencimento: 'Próximo do vencimento',
  vencido: 'Vencido',
  renovado: 'Renovado',
}

export interface CicloLaudo {
  id: string
  lead_id: string
  organizacao_id: string
  validade_em: string      // 'YYYY-MM-DD'
  renovado_em: string | null
  criado_em: string
}

// Forma que a rota /api/leads/[id]/laudo devolve ao cliente: ciclo já com o
// status calculado no servidor (a janela de alerta é config da organização).
export interface CicloLaudoView {
  id: string
  validadeEm: string
  renovadoEm: string | null
  status: StatusLaudo | null
  diasAteVencer: number | null
}

export interface LaudoLeadView {
  alertaDias: number
  atual: CicloLaudoView | null
  historico: CicloLaudoView[]
}

/**
 * Status de um ciclo. Ciclo encerrado (`renovadoEm`) é sempre 'renovado';
 * ciclo atual é classificado pela distância até `validadeEm`:
 *   dias < 0            → vencido
 *   0 ≤ dias ≤ alerta   → proximo_vencimento
 *   dias > alerta       → vigente
 * Devolve null quando não há data válida (lead sem validade).
 */
export function statusLaudo(
  validadeEm: string | null | undefined,
  renovadoEm: string | null | undefined,
  alertaDias: number,
  hoje: Date = new Date(),
): StatusLaudo | null {
  if (renovadoEm) return 'renovado'
  const dias = diasAteVencimento(validadeEm, hoje)
  if (dias === null) return null
  if (dias < 0) return 'vencido'
  if (dias <= alertaDias) return 'proximo_vencimento'
  return 'vigente'
}

// 'YYYY-MM-DD' que existe de verdade (31/02 não passa). Mesma regra que a
// edição cadastral usa para data_validade.
export function dataValidadeValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const d = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor
}

const COLUNAS = 'id, lead_id, organizacao_id, validade_em, renovado_em, criado_em'

export async function listarCiclos(
  admin: SupabaseClient,
  org: string,
  leadId: string,
): Promise<CicloLaudo[]> {
  const { data, error } = await admin
    .from('laudo_ciclos')
    .select(COLUNAS)
    .eq('organizacao_id', org)
    .eq('lead_id', leadId)
    .order('criado_em', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as CicloLaudo[]
}

export type ResultadoSincronizacao = 'criado' | 'atualizado' | 'removido' | 'inalterado'

/**
 * CORREÇÃO de validade (edição manual, importação): mantém o ciclo atual em
 * sincronia com leads.data_validade sem gerar renovação.
 *   - há ciclo atual e a data mudou → atualiza a validade dele
 *   - não há ciclo atual e veio data  → cria o primeiro ciclo
 *   - veio null e há ciclo atual      → remove o ciclo atual (o histórico
 *                                       renovado fica intacto)
 */
export async function sincronizarCicloAtual(
  admin: SupabaseClient,
  org: string,
  leadId: string,
  validade: string | null,
): Promise<ResultadoSincronizacao> {
  const { data: atual, error } = await admin
    .from('laudo_ciclos')
    .select('id, validade_em')
    .eq('organizacao_id', org)
    .eq('lead_id', leadId)
    .is('renovado_em', null)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (!validade) {
    if (!atual) return 'inalterado'
    const { error: eDel } = await admin
      .from('laudo_ciclos').delete().eq('id', atual.id).eq('organizacao_id', org)
    if (eDel) throw new Error(eDel.message)
    return 'removido'
  }

  if (atual) {
    if (String(atual.validade_em).slice(0, 10) === validade) return 'inalterado'
    const { error: eUpd } = await admin
      .from('laudo_ciclos').update({ validade_em: validade }).eq('id', atual.id).eq('organizacao_id', org)
    if (eUpd) throw new Error(eUpd.message)
    return 'atualizado'
  }

  const { error: eIns } = await admin
    .from('laudo_ciclos')
    .insert({ organizacao_id: org, lead_id: leadId, validade_em: validade })
  if (eIns) throw new Error(eIns.message)
  return 'criado'
}

/**
 * Importação em lote: leads recém-inseridos ganham o primeiro ciclo. Só quem
 * veio com validade. Uma inserção só.
 */
export async function criarCiclosIniciais(
  admin: SupabaseClient,
  org: string,
  leads: Array<{ id: string; data_validade: string | null }>,
): Promise<number> {
  const linhas = leads
    .filter((l) => !!l.data_validade)
    .map((l) => ({ organizacao_id: org, lead_id: l.id, validade_em: l.data_validade as string }))
  if (linhas.length === 0) return 0
  const { error } = await admin.from('laudo_ciclos').insert(linhas)
  if (error) throw new Error(error.message)
  return linhas.length
}

export interface ResultadoRenovacaoLaudo {
  cicloAnterior: { id: string; validade_em: string } | null
  cicloAtual: { id: string; validade_em: string }
  tarefasFechadas: number
}

/**
 * RENOVAÇÃO: encerra o ciclo atual (preservado como histórico com
 * renovado_em), abre o novo ciclo com a nova validade, espelha em
 * leads.data_validade e fecha, em background, a tarefa de renovação aberta
 * daquele lead. Se não havia ciclo atual (lead sem validade), simplesmente
 * abre o primeiro.
 *
 * Não é transacional (PostgREST): a ordem foi escolhida para o pior caso ser
 * recuperável. Se a abertura do novo ciclo falhar, o anterior é reaberto.
 */
export async function renovarLaudo(
  admin: SupabaseClient,
  org: string,
  leadId: string,
  novaValidade: string,
): Promise<ResultadoRenovacaoLaudo> {
  if (!dataValidadeValida(novaValidade)) throw new Error('Nova validade inválida (use AAAA-MM-DD).')
  const agora = new Date().toISOString()

  // 1) Encerra o ciclo atual — vira histórico.
  const { data: anterior, error: e1 } = await admin
    .from('laudo_ciclos')
    .update({ renovado_em: agora })
    .eq('organizacao_id', org)
    .eq('lead_id', leadId)
    .is('renovado_em', null)
    .select('id, validade_em')
    .maybeSingle()
  if (e1) throw new Error(e1.message)

  // 2) Abre o novo ciclo.
  const { data: novo, error: e2 } = await admin
    .from('laudo_ciclos')
    .insert({ organizacao_id: org, lead_id: leadId, validade_em: novaValidade })
    .select('id, validade_em')
    .single()
  if (e2 || !novo) {
    // Compensação: não deixar o lead sem ciclo atual.
    if (anterior) {
      await admin.from('laudo_ciclos').update({ renovado_em: null }).eq('id', anterior.id).eq('organizacao_id', org)
    }
    throw new Error(e2?.message ?? 'Falha ao abrir o novo ciclo.')
  }

  // 3) Espelha em leads.data_validade (fonte que o resto do sistema lê).
  const { error: e3 } = await admin
    .from('leads')
    .update({ data_validade: novaValidade })
    .eq('id', leadId)
    .eq('organizacao_id', org)
  if (e3) throw new Error(e3.message)

  // 4) Fecha a tarefa de renovação aberta (background: não bloqueia nem falha
  //    a renovação — o ciclo já está registrado).
  let tarefasFechadas = 0
  const { data: tarefas, error: e4 } = await admin
    .from('tarefas')
    .update({ status: 'concluida', concluido_em: agora })
    .eq('organizacao_id', org)
    .eq('lead_id', leadId)
    .eq('tipo', 'renovacao')
    .eq('status', 'aberta')
    .select('id')
  if (e4) console.warn('[laudos] renovado, mas não fechou a tarefa de renovação:', e4.message)
  else tarefasFechadas = tarefas?.length ?? 0

  return {
    cicloAnterior: anterior ? { id: anterior.id, validade_em: String(anterior.validade_em).slice(0, 10) } : null,
    cicloAtual: { id: novo.id, validade_em: String(novo.validade_em).slice(0, 10) },
    tarefasFechadas,
  }
}
