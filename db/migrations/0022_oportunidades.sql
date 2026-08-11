-- ============================================================================
-- Migration 0022 — Fase 5: Oportunidades (deals) como ENTIDADE própria
-- ----------------------------------------------------------------------------
-- Uma oportunidade é um negócio em andamento: valor, estágio no pipeline,
-- probabilidade e status (aberta/ganha/perdida). É a base do ROI (Fase 8): só a
-- oportunidade carrega VALOR — leads/tarefas não. Pode nascer de um lead, de uma
-- empresa/contato, ou de um serviço recorrente (renovação de laudo vira deal).
-- Todos os vínculos são NULLABLE: a oportunidade vive por si.
--
-- estagio_id aponta pra pipeline_estagios (migration 0014) — o funil é DADO, não
-- enum de código; papel 'ganho'/'perdido' do estágio é referência para relatório.
-- responsavel_id SEM FK rígida (convenção usuarios.id, ver
-- [[leads-responsavel-data-model]]), como em tarefas (0020).
-- Multi-tenant: organizacao_id + RLS (padrão 0006/0008).
-- 100% ADITIVA e idempotente.
-- ============================================================================

create table if not exists oportunidades (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  lead_id uuid references leads(id) on delete set null,
  empresa_id uuid references empresas(id) on delete set null,
  contato_id uuid references contatos(id) on delete set null,
  servico_id uuid references servicos_recorrentes(id) on delete set null,
  pipeline_id uuid references pipelines(id) on delete set null,
  estagio_id uuid references pipeline_estagios(id) on delete set null,
  titulo text not null,
  valor numeric(14,2),                 -- valor do negócio (base do ROI)
  moeda text not null default 'BRL',
  probabilidade integer check (probabilidade between 0 and 100),
  status text not null default 'aberta' check (status in ('aberta', 'ganha', 'perdida')),
  origem text,                         -- 'renovacao'|'prospeccao'|'manual'|...
  motivo_perda text,
  responsavel_id uuid,                 -- convenção: usuarios.id (sem FK rígida)
  previsao_fechamento date,
  fechada_em timestamptz,              -- carimbo quando vira ganha/perdida
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_oportunidades_organizacao on oportunidades(organizacao_id);
create index if not exists idx_oportunidades_empresa on oportunidades(empresa_id);
create index if not exists idx_oportunidades_lead on oportunidades(lead_id);
create index if not exists idx_oportunidades_status on oportunidades(organizacao_id, status);
create index if not exists idx_oportunidades_previsao on oportunidades(organizacao_id, previsao_fechamento)
  where status = 'aberta';

-- ----------------------------------------------------------------------------
-- Trigger: mantém atualizado_em em toda escrita. Reusável por outras tabelas.
-- ----------------------------------------------------------------------------
create or replace function set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists trg_atualizado_em on oportunidades;
create trigger trg_atualizado_em before update on oportunidades
  for each row execute function set_atualizado_em();

-- Auto-preenchimento de organizacao_id (reusa set_org_id_default).
drop trigger if exists trg_set_org_id on oportunidades;
create trigger trg_set_org_id before insert on oportunidades
  for each row execute function set_org_id_default();

-- RLS por organização (padrão 0008).
do $rls$
declare pol record;
begin
  alter table oportunidades enable row level security;
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'oportunidades'
  loop execute format('drop policy %I on oportunidades', pol.policyname); end loop;
  create policy oportunidades_tenant on oportunidades
    for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
end
$rls$;

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA:
--   select relname, relrowsecurity from pg_class where relname = 'oportunidades';
--   select policyname from pg_policies where tablename = 'oportunidades';
-- ----------------------------------------------------------------------------
