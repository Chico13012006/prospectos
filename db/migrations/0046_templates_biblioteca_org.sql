-- ============================================================================
-- Migration 0046 — Biblioteca de templates por organização
-- ----------------------------------------------------------------------------
-- A tabela `templates` JÁ é multi-tenant desde a 0006/0007: organizacao_id
-- NOT NULL com FK, trigger trg_set_org_id e a policy única templates_tenant.
-- Nada disso é refeito aqui. Esta migration só acrescenta o que a biblioteca
-- (criar/editar/desativar/HTML) precisa:
--
--   1) html           — HTML de e-mail (sanitizado pela aplicação). `corpo`
--                       continua sendo o texto equivalente/fallback.
--   2) atualizado_em  — carimbo mantido por trigger (set_atualizado_em, 0022).
--   3) criado_por /
--      atualizado_por — perfis.id da sessão; ON DELETE SET NULL (padrão 0038:
--                       atribuição não pode travar a remoção de um membro).
--   4) organizacao_id imutável em UPDATE — vale inclusive para service_role,
--      que ignora RLS: um template nunca muda de organização.
--   5) CHECKs de coerência: canal conhecido; HTML só em e-mail; HTML ≤ 200 KB
--      (mesmo teto das campanhas, LIMITE_HTML_CAMPANHA).
--   6) índice (organizacao_id, canal, tipo) — a busca do envio e da publicação
--      de workflow.
--   7) remove os índices únicos GLOBAIS da 0004, se existirem. Eles não têm
--      organizacao_id: impediriam duas organizações de terem o mesmo
--      (canal, tipo) e também bloqueariam as variantes A/B. Não existem em
--      produção (conferido em 15/09/2026); o drop só alinha bancos montados a
--      partir das migrations.
--   8) permissões templates.view (admin + usuario) e templates.manage (admin).
--
-- CONTEÚDO PRESERVADO: nenhuma instrução altera tipo, canal, nicho, ativo,
-- assunto ou corpo de linha existente — há uma campanha ativa lendo as cópias
-- `campanha_*` a cada envio. O único UPDATE preenche a coluna NOVA
-- atualizado_em, antes de o trigger existir.
--
-- Aditiva e idempotente (if not exists / drop if exists / not exists).
--
-- ROLLBACK (manual; o conteúdo original dos templates não é afetado — só se
-- perde o HTML gravado depois desta migration):
--   drop trigger if exists trg_organizacao_imutavel on templates;
--   drop trigger if exists trg_atualizado_em on templates;
--   drop function if exists impedir_troca_organizacao_id();
--   alter table templates drop constraint if exists templates_html_limite;
--   alter table templates drop constraint if exists templates_html_somente_email;
--   alter table templates drop constraint if exists templates_canal_valido;
--   alter table templates alter column canal drop not null;
--   drop index if exists idx_templates_org_canal_tipo;
--   alter table templates drop column if exists atualizado_por,
--     drop column if exists criado_por, drop column if exists atualizado_em,
--     drop column if exists html;
--   delete from perfil_permissoes where permissao in ('templates.view', 'templates.manage');
--   (os índices uq_templates_* da 0004 NÃO devem ser recriados.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1-3) Colunas novas
-- ----------------------------------------------------------------------------
alter table templates add column if not exists html text;
alter table templates add column if not exists atualizado_em timestamptz;
alter table templates add column if not exists criado_por uuid;
alter table templates add column if not exists atualizado_por uuid;

-- Linhas existentes: "última atualização" honesta = criação. Só a coluna nova.
update templates
   set atualizado_em = coalesce(created_at, now())
 where atualizado_em is null;

alter table templates alter column atualizado_em set default now();
alter table templates alter column atualizado_em set not null;

alter table templates drop constraint if exists templates_criado_por_fkey;
alter table templates
  add constraint templates_criado_por_fkey
  foreign key (criado_por) references perfis(id) on delete set null;

alter table templates drop constraint if exists templates_atualizado_por_fkey;
alter table templates
  add constraint templates_atualizado_por_fkey
  foreign key (atualizado_por) references perfis(id) on delete set null;

drop trigger if exists trg_atualizado_em on templates;
create trigger trg_atualizado_em before update on templates
  for each row execute function set_atualizado_em();

-- ----------------------------------------------------------------------------
-- 4) organizacao_id imutável
-- ----------------------------------------------------------------------------
create or replace function impedir_troca_organizacao_id()
returns trigger
language plpgsql
as $$
begin
  if new.organizacao_id is distinct from old.organizacao_id then
    raise exception 'organizacao_id não pode ser alterado (%).', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_organizacao_imutavel on templates;
create trigger trg_organizacao_imutavel before update on templates
  for each row execute function impedir_troca_organizacao_id();

-- ----------------------------------------------------------------------------
-- 5) Coerência de canal e HTML
-- ----------------------------------------------------------------------------
-- canal tem default 'email', mas aceitava nulo. Não inventa canal: se houver
-- linha nula, a migration para aqui e a linha precisa ser tratada antes.
do $canal$
begin
  if exists (select 1 from templates where canal is null) then
    raise exception 'Há templates com canal nulo; trate-os antes de aplicar a 0046.';
  end if;
end
$canal$;
alter table templates alter column canal set not null;

do $checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'templates_canal_valido') then
    alter table templates add constraint templates_canal_valido
      check (canal in ('email', 'whatsapp', 'linkedin', 'telefone')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'templates_html_somente_email') then
    alter table templates add constraint templates_html_somente_email
      check (html is null or canal = 'email') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'templates_html_limite') then
    alter table templates add constraint templates_html_limite
      check (html is null or octet_length(html) <= 200000) not valid;
  end if;
end
$checks$;

alter table templates validate constraint templates_canal_valido;
alter table templates validate constraint templates_html_somente_email;
alter table templates validate constraint templates_html_limite;

-- ----------------------------------------------------------------------------
-- 6-7) Índices
-- ----------------------------------------------------------------------------
create index if not exists idx_templates_org_canal_tipo
  on templates(organizacao_id, canal, tipo);

drop index if exists uq_templates_generico;
drop index if exists uq_templates_por_nicho;

-- ----------------------------------------------------------------------------
-- 8) Permissões (espelho de PERMISSOES_POR_ROLE em lib/rbac/permissoes.ts)
--    `perfil_permissoes` é autoritativa quando o perfil tem linhas (0015), então
--    só o padrão em código não alcançaria quem já existe.
-- ----------------------------------------------------------------------------
insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, 'templates.view'
from perfis p
where p.role in ('admin', 'usuario')
  and p.organizacao_id is not null
  and not exists (
    select 1 from perfil_permissoes pp
    where pp.perfil_id = p.id and pp.permissao = 'templates.view'
  );

insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, 'templates.manage'
from perfis p
where p.role = 'admin'
  and p.organizacao_id is not null
  and not exists (
    select 1 from perfil_permissoes pp
    where pp.perfil_id = p.id and pp.permissao = 'templates.manage'
  );

-- RLS: inalterada. A policy templates_tenant (0007) segue como backstop do
-- caminho autenticado; as rotas usam service_role e filtram organizacao_id.

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA:
--   select count(*), count(html), count(*) filter (where atualizado_em is null)
--     from templates;                                  -- html=0, nulos=0
--   select tgname from pg_trigger
--    where tgrelid = 'public.templates'::regclass and not tgisinternal;
--   select p.role, pp.permissao, count(*) from perfis p
--     join perfil_permissoes pp on pp.perfil_id = p.id
--    where pp.permissao like 'templates.%' group by 1, 2;
-- ----------------------------------------------------------------------------
