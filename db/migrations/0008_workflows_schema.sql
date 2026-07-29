-- ============================================================================
-- Migration 0008 — Fase 2: schema do módulo de Workflows (SEM execução ainda)
-- ----------------------------------------------------------------------------
-- Cria as 4 tabelas do motor de workflows (workflows, workflow_versoes,
-- workflow_execucoes, workflow_execucao_eventos), multi-tenant por
-- organizacao_id, com RLS de isolamento por organização e o trigger de
-- auto-preenchimento de org nos INSERTs autenticados (mesmo padrão da 0006/0007).
--
-- NÃO cria UI nem motor de execução — isso é Fase 3/4/5. Aqui é só schema +
-- RLS + base para as funções de versionamento (testadas em lib/workflows/).
--
-- Idempotente e aditiva (IF NOT EXISTS / DROP POLICY IF EXISTS / checagens no
-- catálogo). Depende de: organizacoes + current_org_id() + set_org_id_default()
-- (migration 0006) e do fix de RLS (0007). Rode 0006 e 0007 antes.
--
-- AJUSTES CONSCIENTES em relação ao rascunho do prompt-guia (documentados):
--   1) organizacao_id vai nas 4 tabelas (o rascunho só previa em workflows e
--      workflow_execucoes). Denormalizar para versoes/eventos deixa a RLS
--      UNIFORME (organizacao_id = current_org_id()) e evita policy por join —
--      é a mesma lição da 0007 (policy única por tabela, sem brechas).
--   2) workflows ganha `rascunho_definicao jsonb` (não estava no rascunho): é a
--      CASA do rascunho de edição. workflow_versoes guarda só versões PUBLICADAS
--      e IMUTÁVEIS; o rascunho de trabalho fica em workflows.rascunho_definicao
--      até o "Publicar" criar uma nova linha imutável em workflow_versoes.
--   3) workflow_execucoes.lead_id é FK nullable para leads (v1 age sobre leads).
--      "Entidade genérica" fica como extensão futura, fora do escopo desta fase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) workflows — cabeçalho do workflow (1 por org, com rascunho de trabalho).
-- ----------------------------------------------------------------------------
create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  nome text not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'pausado')),
  -- Aponta para a versão publicada vigente (FK adicionada no passo 5, após
  -- workflow_versoes existir — dependência circular resolvida lá).
  versao_atual_id uuid,
  -- Rascunho de edição (grafo gatilho/condicoes/acoes). Null = sem alterações
  -- pendentes desde a última publicação.
  rascunho_definicao jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_workflows_organizacao on workflows(organizacao_id);

-- ----------------------------------------------------------------------------
-- 2) workflow_versoes — snapshots IMUTÁVEIS publicados. Nunca sobrescrever.
-- ----------------------------------------------------------------------------
create table if not exists workflow_versoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  workflow_id uuid not null references workflows(id),
  numero integer not null,
  definicao jsonb not null, -- grafo de gatilho/condicoes/acoes congelado
  publicado_em timestamptz not null default now(),
  publicado_por uuid references perfis(id),
  unique (workflow_id, numero)
);
create index if not exists idx_workflow_versoes_workflow on workflow_versoes(workflow_id);

-- ----------------------------------------------------------------------------
-- 3) workflow_execucoes — uma corrida do workflow para um lead. versao_id é
--    FIXADO na criação e NUNCA muda (execução em andamento não migra de versão).
-- ----------------------------------------------------------------------------
create table if not exists workflow_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  workflow_id uuid not null references workflows(id),
  versao_id uuid not null references workflow_versoes(id),
  lead_id uuid references leads(id),
  passo_atual integer not null default 0,
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'aguardando', 'concluido', 'erro', 'cancelado')),
  -- Espera persistida: quando esta execução deve ser reprocessada pelo poll
  -- (Fase 3). "aguardando" + proxima_verificacao_em vencida = elegível.
  proxima_verificacao_em timestamptz,
  iniciado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_workflow_execucoes_organizacao on workflow_execucoes(organizacao_id);
create index if not exists idx_workflow_execucoes_workflow on workflow_execucoes(workflow_id);
-- Índice do poll: só as que esperam, ordenadas por vencimento (Fase 3).
create index if not exists idx_workflow_execucoes_poll
  on workflow_execucoes(proxima_verificacao_em)
  where status = 'aguardando';

-- ----------------------------------------------------------------------------
-- 4) workflow_execucao_eventos — log append-only de tudo que a execução fez.
-- ----------------------------------------------------------------------------
create table if not exists workflow_execucao_eventos (
  id bigserial primary key,
  organizacao_id uuid not null references organizacoes(id),
  execucao_id uuid not null references workflow_execucoes(id),
  tipo text not null, -- 'execucao_iniciada'|'gatilho_avaliado'|'condicao_avaliada'|'acao_executada'|'erro'|...
  detalhe jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_workflow_eventos_execucao on workflow_execucao_eventos(execucao_id);

-- ----------------------------------------------------------------------------
-- 5) FK circular workflows.versao_atual_id -> workflow_versoes(id).
--    Adicionada agora que ambas as tabelas existem.
-- ----------------------------------------------------------------------------
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'workflows_versao_atual_fk') then
    alter table workflows
      add constraint workflows_versao_atual_fk
      foreign key (versao_atual_id) references workflow_versoes(id);
  end if;
end
$fk$;

-- ----------------------------------------------------------------------------
-- 6) Trigger de auto-preenchimento de organizacao_id em INSERT autenticado.
--    Reusa set_org_id_default() da 0006: o caminho do browser (UI da Fase 4)
--    insere via client de sessão sem informar org; o trigger preenche com
--    current_org_id(). O caminho service_role (lib/workflows/store) informa a
--    org explicitamente, então o trigger não interfere.
-- ----------------------------------------------------------------------------
do $trg$
declare
  t text;
begin
  foreach t in array array['workflows', 'workflow_versoes', 'workflow_execucoes', 'workflow_execucao_eventos']
  loop
    execute format('drop trigger if exists trg_set_org_id on %I', t);
    execute format(
      'create trigger trg_set_org_id before insert on %I for each row execute function set_org_id_default()', t);
  end loop;
end
$trg$;

-- ----------------------------------------------------------------------------
-- 7) RLS: isolamento por organização. Mesmo padrão da 0007 — habilita RLS,
--    remove QUALQUER policy pré-existente (defensivo) e cria só a `_tenant`.
-- ----------------------------------------------------------------------------
do $rls$
declare
  t text;
  pol record;
begin
  foreach t in array array['workflows', 'workflow_versoes', 'workflow_execucoes', 'workflow_execucao_eventos']
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
-- CONFERÊNCIA (rode e olhe): 1 policy `_tenant` por tabela, relrowsecurity=true.
-- ----------------------------------------------------------------------------
-- select tablename, policyname from pg_policies
--  where schemaname='public'
--    and tablename in ('workflows','workflow_versoes','workflow_execucoes','workflow_execucao_eventos')
--  order by tablename;
-- select relname, relrowsecurity from pg_class
--  where relname in ('workflows','workflow_versoes','workflow_execucoes','workflow_execucao_eventos');
