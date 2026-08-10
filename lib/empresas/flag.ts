import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseWorkspaceConfig, type WorkspaceConfig } from '@/lib/config/workspaceConfig'

// Ativação da leitura via entidades (Empresa/Contato) no LeadPanel, POR
// ORGANIZAÇÃO, com rollback instantâneo. Fonte única da verdade: o blob TIPADO
// `organizacoes.configuracoes` (features.empresaContatoReads) — NÃO mais env var.
//
// Por que saiu da env: a resolução por `EMPRESA_CONTATO_READS(_ORGS)` quebrou em
// produção (GET /api/flags retornava false até para a org habilitada). Config
// por org, resolvida SEMPRE no servidor, elimina essa superfície: nada de
// NEXT_PUBLIC, nada de ID exposto, nada de habilitação global.
//
// Default seguro: ausência da flag => LEGADO (lê de leads). Como o adapter é
// comprovadamente equivalente ao legado (validação 2e: 0 diferenças em 520
// leads), ligar/desligar não muda o dado exibido — só a FONTE. Rollback = pôr
// features.empresaContatoReads=false na org (efeito imediato, sem deploy).

// Resolução PURA a partir da config já parseada (testável sem banco).
export function leituraEntidadesLigadaConfig(cfg: WorkspaceConfig): boolean {
  return cfg.features?.empresaContatoReads === true
}

// Resolução no SERVIDOR para UMA organização: lê o blob da org e aplica a regra.
// Recebe o client admin (service_role) já resolvido pela rota — não abre sessão.
export async function leituraEntidadesLigada(admin: SupabaseClient, org: string): Promise<boolean> {
  const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  return leituraEntidadesLigadaConfig(parseWorkspaceConfig(data?.configuracoes))
}
