-- ============================================================================
-- Migration 0015 — Fase 1: RBAC granular (permissões por perfil)
-- ----------------------------------------------------------------------------
-- 100% ADITIVA e idempotente. NÃO remove o modelo atual (`perfis.role`
-- admin|usuario) — o RBAC granular é uma CAMADA por cima. Preserva o acesso
-- atual: o backfill concede a cada perfil o conjunto padrão do seu role, e
-- ADMINS recebem TODAS as permissões.
--
-- Fonte da verdade da autorização passa a ser `perfil_permissoes` (por usuário),
-- com fallback para o padrão do role quando o usuário não tem nenhuma linha
-- (rede de segurança p/ perfis criados antes do backfill). Ver lib/rbac/.
--
-- As 10 permissões vêm da seção 8 da spec. As listas do backfill abaixo são
-- espelho de PERMISSOES_POR_ROLE em lib/rbac/permissoes.ts — mantenha em sincronia.
--
-- Multi-tenant: organizacao_id + RLS por org (padrão 0006/0008), trigger
-- set_org_id_default() reutilizado. `on delete cascade` de perfis limpa as
-- permissões quando um membro é removido.
-- ============================================================================

create table if not exists perfil_permissoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  perfil_id uuid not null references perfis(id) on delete cascade,
  permissao text not null,
  criado_em timestamptz not null default now(),
  unique (perfil_id, permissao)
);
create index if not exists idx_perfil_permissoes_organizacao on perfil_permissoes(organizacao_id);
create index if not exists idx_perfil_permissoes_perfil on perfil_permissoes(perfil_id);

-- Trigger de auto-preenchimento de organizacao_id (reusa set_org_id_default).
drop trigger if exists trg_set_org_id on perfil_permissoes;
create trigger trg_set_org_id before insert on perfil_permissoes
  for each row execute function set_org_id_default();

-- RLS: isolamento por organização (mesmo padrão da 0008).
do $rls$
declare
  pol record;
begin
  alter table perfil_permissoes enable row level security;
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'perfil_permissoes'
  loop
    execute format('drop policy %I on perfil_permissoes', pol.policyname);
  end loop;
  create policy perfil_permissoes_tenant on perfil_permissoes
    for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
end
$rls$;

-- ----------------------------------------------------------------------------
-- BACKFILL — concede a cada perfil o conjunto padrão do seu role.
--   admin   -> TODAS as 10 permissões
--   usuario -> baseline de leitura (não remove nada que ele já via)
-- Idempotente: on conflict (perfil_id, permissao) do nothing.
-- ----------------------------------------------------------------------------
insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, perm
from perfis p
cross join lateral (
  select unnest(
    case when p.role = 'admin' then array[
      'campaigns.view','campaigns.manage','campaigns.approve','campaigns.operate',
      'workflows.view','workflows.manage','workflows.publish','workflows.executions.manage',
      'workspace.configure','analytics.view'
    ]
    else array['campaigns.view','workflows.view','analytics.view'] end
  ) as perm
) x
on conflict (perfil_id, permissao) do nothing;

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA:
--   select p.role, count(*) from perfis p
--     join perfil_permissoes pp on pp.perfil_id = p.id group by p.role;
--   -- admin deve ter 10 por perfil; usuario, 3.
-- ----------------------------------------------------------------------------
