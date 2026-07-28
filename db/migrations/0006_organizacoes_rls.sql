-- ============================================================================
-- Migration 0006 — Fundação multi-tenant: organizacoes + organizacao_id + RLS
-- ----------------------------------------------------------------------------
-- Cria o conceito de organização (tenant), adiciona organizacao_id nas tabelas
-- de dados, faz backfill de UMA organização padrão para todos os dados atuais
-- (pra não quebrar produção) e liga Row Level Security com isolamento por
-- organização em todas elas.
--
-- Idempotente: usa IF NOT EXISTS / DROP ... IF EXISTS / checagens no catálogo,
-- pode rodar mais de uma vez sem erro.
--
-- EXCEÇÃO CONSCIENTE ao "sem DROP" das migrations 0001-0005:
--   `configuracoes_motor` deixa de ser singleton (id=1) e passa a ter 1 linha
--   POR organização. Pra isso removemos o CHECK(id=1) e o PRIMARY KEY antigo —
--   apenas CONSTRAINTS, nunca dados nem colunas. Sem isso, multi-tenant de
--   config é impossível (o singleton bloquearia a 2ª org). Documentado no bloco.
--
-- SEGURANÇA (leia junto com a arquitetura da Fase 1):
--   - RLS protege o caminho autenticado (client do browser carrega a sessão do
--     login desde o passo 1 da Fase 1 — lib/api.ts). auth.uid() resolve e as
--     policies filtram por organização.
--   - O caminho service_role (createSupabaseAdminClient nas rotas de API e no
--     motor) faz BYPASS de RLS por natureza — por isso esses caminhos filtram
--     organizacao_id EXPLICITAMENTE no código (não é redundância, é obrigatório).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabela de organizações (tenants).
-- ----------------------------------------------------------------------------
create table if not exists organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2) Organização padrão — destino do backfill. UUID FIXO e determinístico para
--    idempotência e para o motor/scripts referenciarem (ORG_PADRAO_ID em
--    lib/engine/config.ts). NÃO mude este UUID.
-- ----------------------------------------------------------------------------
insert into organizacoes (id, nome, slug)
values ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3) organizacao_id nas 5 tabelas de dados. Padrão seguro: adiciona NULLABLE,
--    faz backfill p/ a org padrão, só então marca NOT NULL + índice.
-- ----------------------------------------------------------------------------
do $mt$
declare
  t text;
begin
  foreach t in array array['leads', 'interacoes', 'templates', 'usuarios', 'perfis']
  loop
    execute format(
      'alter table %I add column if not exists organizacao_id uuid references organizacoes(id)', t);
    execute format(
      'update %I set organizacao_id = ''00000000-0000-0000-0000-000000000001'' where organizacao_id is null', t);
    execute format(
      'alter table %I alter column organizacao_id set not null', t);
    execute format(
      'create index if not exists idx_%s_organizacao on %I(organizacao_id)', t, t);
  end loop;
end
$mt$;

-- ----------------------------------------------------------------------------
-- 4) configuracoes_motor: singleton id=1 -> 1 linha por organização.
--    (ver EXCEÇÃO CONSCIENTE no topo)
-- ----------------------------------------------------------------------------
alter table configuracoes_motor
  add column if not exists organizacao_id uuid references organizacoes(id);
update configuracoes_motor
  set organizacao_id = '00000000-0000-0000-0000-000000000001'
  where organizacao_id is null;

-- remove o singleton e o PK antigo (apenas constraints)
alter table configuracoes_motor drop constraint if exists configuracoes_motor_singleton;
alter table configuracoes_motor drop constraint if exists configuracoes_motor_pkey;

alter table configuracoes_motor alter column organizacao_id set not null;

-- a coluna `id` perde o sentido de singleton: deixa de ser obrigatória/default 1
do $cfg$
begin
  begin
    alter table configuracoes_motor alter column id drop default;
  exception when others then null;
  end;
  begin
    alter table configuracoes_motor alter column id drop not null;
  exception when others then null;
  end;
end
$cfg$;

-- novo PK por organização
do $pk$
begin
  if not exists (select 1 from pg_constraint where conname = 'configuracoes_motor_org_pk') then
    alter table configuracoes_motor
      add constraint configuracoes_motor_org_pk primary key (organizacao_id);
  end if;
end
$pk$;

-- ----------------------------------------------------------------------------
-- 5) Helper SECURITY DEFINER: organização do usuário logado, SEM recursão de
--    RLS. Roda como dono da função (bypassa RLS ao ler `perfis`), então pode
--    ser usada dentro das policies de `perfis` sem loop infinito.
-- ----------------------------------------------------------------------------
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select organizacao_id from perfis where id = auth.uid()
$fn$;

-- ----------------------------------------------------------------------------
-- 5b) Auto-preenchimento de organizacao_id em INSERTs autenticados.
--     O caminho do BROWSER (lib/api.ts: registrarNota, createInteracao,
--     createLead) insere via client anon+sessão, sujeito à RLS, e NÃO informa
--     organizacao_id. Sem isto, esses INSERTs violariam o NOT NULL e o
--     WITH CHECK da RLS — quebraria o painel de lead (adicionar nota, mudar
--     estágio, marcar perdido, liberar p/ motor).
--
--     Este trigger BEFORE INSERT preenche organizacao_id := current_org_id()
--     SÓ quando vem nulo. O motor (service_role) SEMPRE informa organizacao_id
--     explicitamente, então NEW.organizacao_id não é nulo e o trigger não
--     interfere. Se um INSERT service_role omitir a coluna, current_org_id()
--     é nulo (sem auth.uid()) e o NOT NULL falha ALTO — rede de segurança, não
--     atribuição silenciosa errada.
-- ----------------------------------------------------------------------------
create or replace function set_org_id_default()
returns trigger
language plpgsql
as $trg$
begin
  if new.organizacao_id is null then
    new.organizacao_id := current_org_id();
  end if;
  return new;
end
$trg$;

do $trg_attach$
declare
  t text;
begin
  foreach t in array array['leads', 'interacoes', 'templates', 'usuarios', 'perfis']
  loop
    execute format('drop trigger if exists trg_set_org_id on %I', t);
    execute format(
      'create trigger trg_set_org_id before insert on %I for each row execute function set_org_id_default()', t);
  end loop;
end
$trg_attach$;

-- ----------------------------------------------------------------------------
-- 6) Row Level Security: isolamento por organização.
--    Uma policy permissiva por tabela cobrindo select/insert/update/delete
--    (FOR ALL). service_role continua fazendo bypass (BYPASSRLS).
-- ----------------------------------------------------------------------------

-- organizacoes: cada usuário só enxerga/edita a PRÓPRIA organização.
alter table organizacoes enable row level security;
drop policy if exists organizacoes_tenant on organizacoes;
create policy organizacoes_tenant on organizacoes
  for all
  using (id = current_org_id())
  with check (id = current_org_id());

-- tabelas com organizacao_id.
do $rls$
declare
  t text;
begin
  foreach t in array array['leads', 'interacoes', 'templates', 'usuarios', 'perfis', 'configuracoes_motor']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format(
      'create policy %I on %I for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id())',
      t || '_tenant', t);
  end loop;
end
$rls$;

-- ----------------------------------------------------------------------------
-- COMO CRIAR UMA SEGUNDA ORGANIZAÇÃO (teste de isolamento — rodar no Supabase):
--   insert into organizacoes (nome, slug) values ('Org Teste', 'teste');
--   -- crie um usuário de auth para ela e ligue o perfil:
--   -- update perfis set organizacao_id = '<uuid-org-teste>' where id = '<uid>';
--   -- logado como esse usuário, os SELECT de leads/templates/usuarios devem
--   -- voltar VAZIOS em relação à org padrão (isolamento por RLS).
-- ----------------------------------------------------------------------------
