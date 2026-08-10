-- ============================================================================
-- Migration 0019 — Fase 3: Serviços recorrentes (laudos) como ENTIDADE própria
-- ----------------------------------------------------------------------------
-- Um serviço recorrente (ex.: laudo técnico) é registro PRÓPRIO, N por empresa,
-- com data de realização, periodicidade configurável e vencimento CALCULADO —
-- não são colunas em leads/empresa. Assim uma empresa tem histórico de vários
-- laudos/vencimentos. `tipo` é livre por workspace (não hardcoda "laudo").
--
-- vencimento_em é mantido por TRIGGER (realizado_em + periodicidade) em toda
-- escrita — consistente por qualquer caminho. Arquivamento sem exclusão
-- (arquivado/arquivado_em). Multi-tenant: organizacao_id + RLS (padrão 0006/0008).
-- ============================================================================

create table if not exists servicos_recorrentes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  empresa_id uuid not null references empresas(id) on delete cascade,
  tipo text,                       -- livre por workspace (ex.: 'laudo'); nunca hardcoded
  realizado_em date,               -- quando o serviço/laudo foi feito (âncora do vencimento)
  periodicidade_valor integer,     -- ex.: 6
  periodicidade_unidade text check (periodicidade_unidade in ('dias', 'meses', 'anos')),
  vencimento_em date,              -- CALCULADO (trigger): realizado_em + periodicidade
  status text not null default 'vigente' check (status in ('vigente', 'vencido', 'renovado', 'cancelado')),
  observacoes text,
  origem text,
  arquivado boolean not null default false,
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_servicos_organizacao on servicos_recorrentes(organizacao_id);
create index if not exists idx_servicos_empresa on servicos_recorrentes(empresa_id);
-- Índice do "janela de renovação" (Fase 4): buscar por vencimento próximo.
create index if not exists idx_servicos_vencimento on servicos_recorrentes(organizacao_id, vencimento_em)
  where arquivado = false;

-- ----------------------------------------------------------------------------
-- Trigger: calcula vencimento_em a partir de realizado_em + periodicidade.
-- make_interval é imutável; date + interval → cast p/ date. Nulo se faltar dado.
-- ----------------------------------------------------------------------------
create or replace function calc_vencimento_servico()
returns trigger
language plpgsql
as $$
begin
  if new.realizado_em is null or new.periodicidade_valor is null or new.periodicidade_unidade is null then
    new.vencimento_em := null;
  elsif new.periodicidade_unidade = 'dias' then
    new.vencimento_em := (new.realizado_em + make_interval(days => new.periodicidade_valor))::date;
  elsif new.periodicidade_unidade = 'meses' then
    new.vencimento_em := (new.realizado_em + make_interval(months => new.periodicidade_valor))::date;
  elsif new.periodicidade_unidade = 'anos' then
    new.vencimento_em := (new.realizado_em + make_interval(years => new.periodicidade_valor))::date;
  else
    new.vencimento_em := null;
  end if;
  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists trg_calc_vencimento on servicos_recorrentes;
create trigger trg_calc_vencimento
  before insert or update on servicos_recorrentes
  for each row execute function calc_vencimento_servico();

-- Auto-preenchimento de organizacao_id (reusa set_org_id_default).
drop trigger if exists trg_set_org_id on servicos_recorrentes;
create trigger trg_set_org_id before insert on servicos_recorrentes
  for each row execute function set_org_id_default();

-- RLS por organização (padrão 0008).
do $rls$
declare pol record;
begin
  alter table servicos_recorrentes enable row level security;
  for pol in select policyname from pg_policies where schemaname='public' and tablename='servicos_recorrentes'
  loop execute format('drop policy %I on servicos_recorrentes', pol.policyname); end loop;
  create policy servicos_recorrentes_tenant on servicos_recorrentes
    for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id());
end
$rls$;
