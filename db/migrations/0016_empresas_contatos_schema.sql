-- ============================================================================
-- Migration 0016 — Fase 2a: schema Empresa × Contato (SÓ schema, sem backfill)
-- ----------------------------------------------------------------------------
-- 100% ADITIVA e idempotente. NÃO faz backfill, NÃO altera telas, NÃO toca no
-- motor. Cria `empresas` e `contatos` e adiciona as colunas-ponte NULLABLE
-- `empresa_id`/`contato_id` em `leads`. Enquanto o backfill (Fase 2b) não roda,
-- essas colunas ficam NULL e nada muda de comportamento — `leads` segue sendo a
-- fonte da verdade do motor (owner=engine).
--
-- Garantias pedidas:
--   - organizacao_id + RLS por org (padrão 0006/0008) em ambas as tabelas
--   - timestamps (criado_em / atualizado_em)
--   - origem dos dados (coluna `origem`: import_hubspot|google_maps|csv|manual|
--     lead_backfill|...)  — de onde o registro veio
--   - arquivamento SEM exclusão do histórico (arquivado + arquivado_em)
--   - contatos.empresa_id NULLABLE (contato ainda sem empresa identificada)
--   - CNPJ normalizado (só dígitos) ÚNICO por organização QUANDO preenchido
--     (índice único PARCIAL) — nunca rígido em domínio/e-mail (filiais podem
--     compartilhar domínio; um contato pode aparecer em contextos diferentes)
--
-- FKs com ON DELETE SET NULL: remover uma empresa nunca apaga contatos/leads,
-- só desfaz a ligação — o histórico permanece intacto.
-- Depende de: organizacoes + current_org_id() + set_org_id_default() (0006).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) empresas
-- ----------------------------------------------------------------------------
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  nome text not null,
  cnpj text,                      -- normalizado (só dígitos); ver lib/empresas/cnpj.ts
  dominio text,
  segmento text,
  cidade text,
  estado text,
  pais text,
  site text,
  telefone text,
  faixa_funcionarios text,
  origem text,                    -- de onde o dado veio
  observacoes text,
  arquivado boolean not null default false,
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_empresas_organizacao on empresas(organizacao_id);
-- Busca por domínio na dedup (NÃO único — filiais compartilham domínio).
create index if not exists idx_empresas_dominio on empresas(organizacao_id, dominio);
-- CNPJ único POR ORG quando preenchido (índice parcial). Assume valor já
-- normalizado (só dígitos) pela aplicação.
create unique index if not exists uq_empresas_cnpj_org
  on empresas(organizacao_id, cnpj)
  where cnpj is not null and cnpj <> '';

-- ----------------------------------------------------------------------------
-- 2) contatos (decisores). empresa_id NULLABLE de propósito.
-- ----------------------------------------------------------------------------
create table if not exists contatos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  empresa_id uuid references empresas(id) on delete set null,
  nome text,
  cargo text,
  email text,
  email_validado boolean not null default false,
  telefone text,
  whatsapp text,
  linkedin text,
  senioridade text,
  origem text,                    -- fonte do dado do contato
  observacoes text,
  arquivado boolean not null default false,
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_contatos_organizacao on contatos(organizacao_id);
create index if not exists idx_contatos_empresa on contatos(empresa_id);
-- Busca por e-mail (NÃO único — mesmo contato pode aparecer em contextos diferentes).
create index if not exists idx_contatos_email on contatos(organizacao_id, email);

-- ----------------------------------------------------------------------------
-- 3) Colunas-ponte em leads (NULLABLE, sem backfill). ON DELETE SET NULL para
--    que remover empresa/contato nunca quebre o lead — só desfaz a ligação.
-- ----------------------------------------------------------------------------
alter table leads add column if not exists empresa_id uuid references empresas(id) on delete set null;
alter table leads add column if not exists contato_id uuid references contatos(id) on delete set null;
create index if not exists idx_leads_empresa on leads(empresa_id);
create index if not exists idx_leads_contato on leads(contato_id);

-- ----------------------------------------------------------------------------
-- 4) Trigger de auto-preenchimento de organizacao_id (reusa set_org_id_default).
-- ----------------------------------------------------------------------------
do $trg$
declare
  t text;
begin
  foreach t in array array['empresas', 'contatos']
  loop
    execute format('drop trigger if exists trg_set_org_id on %I', t);
    execute format(
      'create trigger trg_set_org_id before insert on %I for each row execute function set_org_id_default()', t);
  end loop;
end
$trg$;

-- ----------------------------------------------------------------------------
-- 5) RLS: isolamento por organização (mesmo padrão da 0008).
-- ----------------------------------------------------------------------------
do $rls$
declare
  t text;
  pol record;
begin
  foreach t in array array['empresas', 'contatos']
  loop
    execute format('alter table %I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', pol.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id())',
      t || '_tenant', t);
  end loop;
end
$rls$;

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA:
--   select relname, relrowsecurity from pg_class where relname in ('empresas','contatos');
--   select conname, confdeltype from pg_constraint where conrelid in
--     ('leads'::regclass,'contatos'::regclass) and contype='f'
--     and conname like '%empresa%' or conname like '%contato%';
-- ----------------------------------------------------------------------------
