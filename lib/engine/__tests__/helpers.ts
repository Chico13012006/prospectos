// Fábrica de leads para os testes (defaults sãos; owner='engine' por padrão).
import type { Lead } from '../types'

let seq = 0

export function makeLead(over: Partial<Lead> = {}): Lead {
  seq++
  const now = new Date().toISOString()
  return {
    id: over.id ?? `lead-${seq}`,
    empresa: over.empresa ?? `Empresa ${seq}`,
    cidade: over.cidade ?? 'São Paulo',
    estado: over.estado ?? 'SP',
    segmento: over.segmento ?? 'Logística',
    faixa_funcionarios: over.faixa_funcionarios ?? '50-200',
    site: over.site,
    linkedin: over.linkedin,
    contato_nome: over.contato_nome ?? 'Ana Teste',
    contato_cargo: over.contato_cargo ?? 'Diretora de Operações',
    contato_email: over.contato_email ?? `contato${seq}@empresa${seq}.com.br`,
    contato_telefone: over.contato_telefone,
    canal_preferencial: over.canal_preferencial ?? 'email',
    estagio: over.estagio ?? 'novos_leads',
    score: over.score ?? 50,
    responsavel_id: over.responsavel_id,
    ultimo_contato: over.ultimo_contato,
    proxima_acao: over.proxima_acao,
    proxima_acao_data: over.proxima_acao_data,
    origem: over.origem ?? 'manual',
    hubspot_id: over.hubspot_id,
    perdido: over.perdido ?? false,
    perdido_motivo: over.perdido_motivo,
    created_at: over.created_at ?? now,
    updated_at: over.updated_at ?? now,
    owner: over.owner ?? 'engine',
    tese_comercial: over.tese_comercial ?? null,
    dominio: over.dominio ?? null,
  }
}

export const ONTEM = new Date(Date.now() - 24 * 3600_000).toISOString()
export const SEMANA_PASSADA = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
export const AMANHA = new Date(Date.now() + 24 * 3600_000).toISOString()
