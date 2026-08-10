// RBAC granular (Fase 1). As 10 permissões são DEFINIDAS EM CÓDIGO (estruturais,
// não dado criável pelo usuário) — espelham a seção 8 da spec. A autorização
// efetiva de cada usuário vive em `perfil_permissoes` (migration 0015); este
// módulo é a fonte da verdade dos slugs válidos e do padrão por role.

export const PERMISSOES = [
  'campaigns.view',
  'campaigns.manage',
  'campaigns.approve',
  'campaigns.operate',
  'workflows.view',
  'workflows.manage',
  'workflows.publish',
  'workflows.executions.manage',
  'workspace.configure',
  'analytics.view',
] as const

export type Permissao = (typeof PERMISSOES)[number]

const CONJUNTO = new Set<string>(PERMISSOES)
export function isPermissao(x: unknown): x is Permissao {
  return typeof x === 'string' && CONJUNTO.has(x)
}

// Roles existentes no schema atual (perfis.role). O RBAC é camada por cima —
// não substitui o role, mapeia-o para um conjunto padrão de permissões.
export type RolePadrao = 'admin' | 'usuario'

// Padrão por role. admin = tudo; usuario = baseline de LEITURA (não remove nada
// que ele já via hoje — campanhas/workflows-manage/configure nunca foram dele).
// ESPELHO do backfill da migration 0015 — manter em sincronia.
export const PERMISSOES_POR_ROLE: Record<RolePadrao, Permissao[]> = {
  admin: [...PERMISSOES],
  usuario: ['campaigns.view', 'workflows.view', 'analytics.view'],
}

// Permissões EFETIVAS de um usuário. `perfil_permissoes` é autoritativa: se há
// linhas, valem elas (permite conceder/revogar por usuário no futuro). Sem
// nenhuma linha (perfil não backfillado) → cai no padrão do role, como rede de
// segurança para não trancar ninguém. Slugs inválidos são descartados.
export function permissoesEfetivas(role: string, grants: readonly string[]): Set<Permissao> {
  const validos = grants.filter(isPermissao)
  if (validos.length > 0) return new Set(validos)
  const def = PERMISSOES_POR_ROLE[role as RolePadrao] ?? []
  return new Set(def)
}

export function temPermissao(role: string, grants: readonly string[], alvo: Permissao): boolean {
  return permissoesEfetivas(role, grants).has(alvo)
}
