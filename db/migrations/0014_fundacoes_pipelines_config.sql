-- ============================================================================
-- Migration 0014 — Fase 0: fundações (organizacoes config, pipelines, auditoria)
-- ----------------------------------------------------------------------------
-- 100% ADITIVA e idempotente (IF NOT EXISTS / DROP ... IF EXISTS / on conflict).
-- Não altera nem remove colunas/dados existentes, não toca no motor.
--
--   1) organizacoes: +nicho, +configuracoes jsonb. O jsonb é SÓ para
--      PREFERÊNCIAS FLEXÍVEIS (widgets, nomenclaturas, toggles) — nunca dado
--      estrutural, que é tabela/coluna real. A disciplina de schema/validação/
--      versionamento vive em lib/config/workspaceConfig.ts; o `_schema_version`
--      fica DENTRO do blob. Default '{}' = "todos os padrões".
--
--   2) pipelines (PAI) + pipeline_estagios (FILHA, FK pipeline_id) — tira o
--      estágio do union type fixo (lib/engine/types.ts) e o torna DADO. Nesta
--      fase é tabela de REFERÊNCIA: `leads.estagio` continua text e o motor NÃO
--      muda. A ligação real (FK/membership do lead a um estágio) é passo
--      posterior e gated (fase de Oportunidades) — aqui nada quebra.
--
--   3) interacoes.motivo — auditabilidade (seções 9/11 da spec): motivo
--      explícito das ações automáticas, além da descrição.
--
-- Multi-tenant: organizacao_id + RLS por org (mesmo padrão das 0006/0007/0008),
-- reutilizando set_org_id_default() e current_org_id() (migration 0006).
-- Depende de: organizacoes + as duas funções (rode 0006/0007 antes).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) organizacoes: nicho + configuracoes (jsonb de preferências)
-- ----------------------------------------------------------------------------
alter table organizacoes add column if not exists nicho text;
alter table organizacoes add column if not exists configuracoes jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2) pipelines — tabela PAI (1..N por organização).
-- ----------------------------------------------------------------------------
create table if not exists pipelines (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  nome text not null,
  -- Tipo do pipeline (prospeccao|renovacao|...). Livre por workspace; sem enum
  -- de código para não hardcodar a operação de laudos.
  tipo text not null default 'prospeccao',
  descricao text,
  ativo boolean not null default true,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists idx_pipelines_organizacao on pipelines(organizacao_id);

-- ----------------------------------------------------------------------------
-- 2b) pipeline_estagios — tabela FILHA (FK pipeline_id).
-- ----------------------------------------------------------------------------
create table if not exists pipeline_estagios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  -- Slug estável: HOJE bate com os valores de leads.estagio (ponte futura).
  chave text not null,
  nome text not null,
  ordem integer not null default 0,
  cor text,
  -- Papel do estágio no funil — DADO, não enum de código.
  papel text not null default 'normal' check (papel in ('inicial', 'normal', 'ganho', 'perdido')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (pipeline_id, chave)
);
create index if not exists idx_pipeline_estagios_organizacao on pipeline_estagios(organizacao_id);
create index if not exists idx_pipeline_estagios_pipeline on pipeline_estagios(pipeline_id);

-- ----------------------------------------------------------------------------
-- 3) interacoes.motivo — motivo explícito das ações automáticas (auditoria).
-- ----------------------------------------------------------------------------
alter table interacoes add column if not exists motivo text;

-- ----------------------------------------------------------------------------
-- 4) Trigger de auto-preenchimento de organizacao_id (reusa set_org_id_default).
-- ----------------------------------------------------------------------------
do $trg$
declare
  t text;
begin
  foreach t in array array['pipelines', 'pipeline_estagios']
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
  foreach t in array array['pipelines', 'pipeline_estagios']
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
-- 6) SEED — só a organização padrão, ESPELHANDO os estágios REAIS que o motor
--    usa hoje (ESTAGIOS_EM_CADENCIA / proximoEstagio em lib/engine/templates.ts).
--    Não inventa a nomenclatura futura da spec (isso é configurável na fase de
--    Configurações > Pipelines). Idempotente pela unique (pipeline_id, chave).
-- ----------------------------------------------------------------------------
do $seed$
declare
  org uuid := '00000000-0000-0000-0000-000000000001';
  pid uuid;
begin
  select id into pid from pipelines where organizacao_id = org and tipo = 'prospeccao' limit 1;
  if pid is null then
    insert into pipelines (organizacao_id, nome, tipo, descricao, ordem)
    values (org, 'Prospecção', 'prospeccao',
            'Pipeline padrão de prospecção (espelho dos estágios atuais do motor).', 0)
    returning id into pid;
  end if;

  insert into pipeline_estagios (organizacao_id, pipeline_id, chave, nome, ordem, cor, papel)
  values
    (org, pid, 'novos_leads',         'Novos leads',         0, '#64748b', 'inicial'),
    (org, pid, 'primeiro_contato',    '1º contato',          1, '#6366f1', 'normal'),
    (org, pid, 'aguardando_resposta', 'Aguardando resposta', 2, '#eab308', 'normal'),
    (org, pid, 'follow_up',           'Follow-up',           3, '#f97316', 'normal'),
    (org, pid, 'interessado',         'Interessado',         4, '#22c55e', 'normal'),
    (org, pid, 'reuniao_agendada',    'Reunião agendada',    5, '#06b6d4', 'ganho'),
    (org, pid, 'perdido',             'Perdido',             6, '#ef4444', 'perdido'),
    (org, pid, 'sem_resposta',        'Sem resposta',        7, '#475569', 'perdido')
  on conflict (pipeline_id, chave) do nothing;
end
$seed$;

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA (rode e olhe):
--   select relname, relrowsecurity from pg_class where relname in ('pipelines','pipeline_estagios');
--   select p.nome, e.chave, e.ordem, e.papel from pipelines p
--     join pipeline_estagios e on e.pipeline_id = p.id order by e.ordem;
-- ----------------------------------------------------------------------------
