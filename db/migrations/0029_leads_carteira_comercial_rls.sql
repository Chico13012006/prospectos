-- Isolamento da carteira comercial dentro da organização.
-- Admins veem todos os leads; usuários comuns veem e alteram somente os leads
-- atribuídos ao `usuarios.id` correspondente ao e-mail da sessão. Registros
-- legados sem FK preservam o fallback por prefixo de responsavel_nome.

create or replace function current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select role from perfis where id = auth.uid()
$fn$;

create or replace function current_commercial_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id
    from usuarios u
   where u.organizacao_id = current_org_id()
     and u.ativo = true
     and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by u.id
   limit 1
$fn$;

create or replace function current_commercial_user_name()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select u.nome
    from usuarios u
   where u.id = current_commercial_user_id()
$fn$;

alter table leads enable row level security;
drop policy if exists leads_tenant on leads;
drop policy if exists leads_carteira on leads;
create policy leads_carteira on leads
  for all
  using (
    organizacao_id = current_org_id()
    and (
      current_profile_role() = 'admin'
      or responsavel_id = current_commercial_user_id()
      or (
        responsavel_id is null
        and current_commercial_user_name() is not null
        and responsavel_nome ilike current_commercial_user_name() || '%'
      )
    )
  )
  with check (
    organizacao_id = current_org_id()
    and (
      current_profile_role() = 'admin'
      or responsavel_id = current_commercial_user_id()
    )
  );

-- Interações acompanham a visibilidade do lead e não podem ser consultadas
-- diretamente para contornar a política da carteira.
alter table interacoes enable row level security;
drop policy if exists interacoes_tenant on interacoes;
drop policy if exists interacoes_carteira on interacoes;
create policy interacoes_carteira on interacoes
  for all
  using (
    organizacao_id = current_org_id()
    and (
      current_profile_role() = 'admin'
      or exists (
        select 1 from leads l
         where l.id = interacoes.lead_id
           and l.organizacao_id = interacoes.organizacao_id
      )
    )
  )
  with check (
    organizacao_id = current_org_id()
    and (
      current_profile_role() = 'admin'
      or exists (
        select 1 from leads l
         where l.id = interacoes.lead_id
           and l.organizacao_id = interacoes.organizacao_id
      )
    )
  );

create index if not exists idx_leads_org_responsavel_carteira
  on leads(organizacao_id, responsavel_id, id);
