-- ============================================================================
-- Migration 0023 — Fase 7: Campanhas (ativações com PÚBLICO + motor = Workflows)
-- ----------------------------------------------------------------------------
-- Uma campanha é uma ativação nomeada sobre um PÚBLICO de leads, executada pelo
-- motor que já existe: WORKFLOWS (não cria motor novo). `workflow_id` aponta o
-- workflow que roda a cadência; `publico` (jsonb) é o filtro de público
-- (campo/operador/valor — mesma linguagem do bloco 'campo'/filtro genérico).
-- Status controla o ciclo (rascunho→ativa→pausada→concluida). Métricas de ROI
-- (Fase 8) saem das oportunidades/execuções ligadas, não daqui.
-- Multi-tenant: organizacao_id + RLS (padrão 0006/0008). 100% ADITIVA.
-- ============================================================================

create table if not exists campanhas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  nome text not null,
  descricao text,
  tipo text,                          -- 'prospeccao'|'renovacao'|... (livre)
  status text not null default 'rascunho' check (status in ('rascunho', 'ativa', 'pausada', 'concluida')),
  workflow_id uuid references workflows(id) on delete set null,  -- motor reusado
  publico jsonb not null default '{}'::jsonb,                    -- filtro de público
  meta_leads integer,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_campanhas_organizacao on campanhas(organizacao_id);
create index if not exists idx_campanhas_status on campanhas(organizacao_id, status);

-- atualizado_em automático (função set_atualizado_em criada na 0022).
drop trigger if exists trg_atualizado_em on campanhas;
create trigger trg_atualizado_em before update on campanhas
  for each row execute function set_atualizado_em();

-- Auto-org + RLS.
drop trigger if exists trg_set_org_id on campanhas;
create trigger trg_set_org_id before insert on campanhas
  for each row execute function set_org_id_default();

do $rls$
declare pol record;
begin
  alter table campanhas enable row level security;
  for pol in select policyname from pg_policies where schemaname='public' and tablename='campanhas'
  loop execute format('drop policy %I on campanhas', pol.policyname); end loop;
  create policy campanhas_tenant on campanhas
    for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
end
$rls$;
