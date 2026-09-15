import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarProposta } from './normalizar'
import { COLUNAS_LEAD_PROPOSTA, COLUNAS_PROPOSTA, type LeadDaProposta, type PropostaRegistro } from './tipos'

// Grava uma proposta montada no Simulador (POST /api/propostas).
//
// `db` é o client service_role (ignora RLS): o isolamento depende dos filtros
// explícitos abaixo. `organizacaoId` e o autor vêm da SESSÃO, nunca do corpo —
// o corpo só traz as escolhas do vendedor, validadas e completadas por
// normalizarProposta. A checagem de carteira (lead visível para o usuário) é
// feita pela rota antes de chamar aqui.

export type ResultadoSalvarProposta =
  | { ok: true; proposta: PropostaRegistro }
  | { ok: false; codigo: 'invalida' | 'lead_nao_encontrado'; mensagem: string }

export async function salvarProposta(
  db: SupabaseClient,
  entrada: { dados: unknown; organizacaoId: string; usuarioId: string | null; usuarioNome: string | null },
): Promise<ResultadoSalvarProposta> {
  const normalizada = normalizarProposta(entrada.dados)
  if (!normalizada.ok) return { ok: false, codigo: 'invalida', mensagem: normalizada.mensagem }
  const p = normalizada.proposta

  // ISOLAMENTO: lead de outra organização não é encontrado.
  const { data: lead, error: erroLead } = await db
    .from('leads')
    .select(COLUNAS_LEAD_PROPOSTA)
    .eq('id', p.leadId)
    .eq('organizacao_id', entrada.organizacaoId)
    .maybeSingle()
  if (erroLead) throw erroLead
  if (!lead) return { ok: false, codigo: 'lead_nao_encontrado', mensagem: 'Lead não encontrado nesta organização.' }

  const { data, error } = await db
    .from('propostas_comerciais')
    .insert({
      organizacao_id: entrada.organizacaoId, // da sessão, nunca do cliente
      lead_id: p.leadId,
      modelo: p.modelo,
      itens: p.itens,
      valor_final: p.valorFinal,
      mensal_final: p.mensalFinal,
      entrada_final: p.entradaFinal,
      prazo_meses: p.prazoMeses,
      valor_tabela: p.valorTabela,
      mensal_tabela: p.mensalTabela,
      entrada_tabela: p.entradaTabela,
      total: p.total,
      dados_pdf: p.dadosPdf,
      status: 'salva',
      criado_por: entrada.usuarioId,
      criado_por_nome: entrada.usuarioNome,
    })
    .select(COLUNAS_PROPOSTA)
    .single()
  if (error) throw error

  return {
    ok: true,
    proposta: { ...(data as unknown as Omit<PropostaRegistro, 'leads'>), leads: lead as unknown as LeadDaProposta },
  }
}
