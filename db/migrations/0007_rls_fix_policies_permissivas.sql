-- ============================================================================
-- Migration 0007 — CORRIGE vazamento de isolamento multi-tenant (RLS)
-- ----------------------------------------------------------------------------
-- SINTOMA (comprovado por scripts/multitenant-isolamento.ts + diag-rls.ts):
--   Um usuário logado da Org A enxergava TODOS os leads/interacoes/templates/
--   usuarios/perfis de produção (org padrão) e das outras orgs. Ou seja, a RLS
--   NÃO estava isolando essas 5 tabelas — apesar de `organizacoes` e
--   `configuracoes_motor` isolarem corretamente.
--
-- CAUSA:
--   As 5 tabelas vazando são exatamente as que o app lia via client ANON antes
--   da Fase 1. Elas carregavam uma POLICY PERMISSIVA antiga ("allow-all",
--   provavelmente `using (true)` para o papel anon/public, criada na montagem
--   original do projeto). A migration 0006 apenas ADICIONOU a policy `<t>_tenant`
--   e deu `drop` só nela — a policy antiga permaneceu. No Postgres, múltiplas
--   policies PERMISSIVE combinam-se por OR:  allow-all OR tenant = allow-all.
--   Resultado: a tenant era inócua e a tabela continuava totalmente visível.
--   `organizacoes`/`configuracoes_motor` nunca tiveram a policy antiga (o app
--   não as lia via anon), por isso só a `_tenant` valia e elas já isolavam.
--
-- FIX (idempotente e robusto ao NOME da policy antiga):
--   Para cada tabela multi-tenant: garante RLS habilitada, DROPA TODAS as
--   policies existentes (elimina qualquer allow-all remanescente, seja qual for
--   o nome) e recria SOMENTE a policy `_tenant` de isolamento por organização.
--   Rodar quantas vezes quiser: o estado final é sempre "só a tenant".
--
-- SEGURANÇA / IMPACTO:
--   - Caminho autenticado (UI via client de sessão desde o passo 1 da Fase 1):
--     coberto pela policy `_tenant` (auth.uid() -> current_org_id()).
--   - Caminho service_role (motor + rotas de API): tem BYPASSRLS, não é afetado.
--   - Não há leitura ANÔNIMA/deslogada dessas tabelas (app inteiro atrás de
--     login), então remover a allow-all não quebra nenhum fluxo legítimo.
--   - Depende de `current_org_id()` (criada na 0006). Rode a 0006 antes.
--
-- COMO VALIDAR DEPOIS:  npx tsx scripts/multitenant-isolamento.ts  (deve passar)
-- ============================================================================

do $fix$
declare
  t   text;
  pol record;
  n   int;
begin
  -- 1) Tabelas com organizacao_id: policy `<t>_tenant` por organização.
  foreach t in array array['leads', 'interacoes', 'templates', 'usuarios', 'perfis', 'configuracoes_motor']
  loop
    execute format('alter table %I enable row level security', t);

    n := 0;
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', pol.policyname, t);
      n := n + 1;
    end loop;
    raise notice '[%] % policy(ies) antiga(s) removida(s)', t, n;

    execute format(
      'create policy %I on %I for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id())',
      t || '_tenant', t);
  end loop;

  -- 2) organizacoes: isola pela PRÓPRIA linha (id = current_org_id()).
  execute 'alter table organizacoes enable row level security';
  n := 0;
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'organizacoes'
  loop
    execute format('drop policy %I on organizacoes', pol.policyname);
    n := n + 1;
  end loop;
  raise notice '[organizacoes] % policy(ies) antiga(s) removida(s)', n;

  execute 'create policy organizacoes_tenant on organizacoes for all using (id = current_org_id()) with check (id = current_org_id())';
end
$fix$;

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA (rode e olhe o resultado): deve haver EXATAMENTE 1 policy por
-- tabela, todas com nome `<tabela>_tenant`, e relrowsecurity = true.
-- ----------------------------------------------------------------------------
-- select tablename, policyname, permissive, roles, cmd, qual, with_check
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('leads','interacoes','templates','usuarios','perfis','configuracoes_motor','organizacoes')
--  order by tablename, policyname;
--
-- select relname, relrowsecurity
--   from pg_class
--  where relname in ('leads','interacoes','templates','usuarios','perfis','configuracoes_motor','organizacoes');
