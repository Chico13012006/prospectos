-- Corrige o escopo de EXECUTE das funções criadas pela 0047.
--
-- No Supabase, os default privileges do papel `postgres` concedem EXECUTE a
-- anon/authenticated em TODA função nova do schema public. O `revoke all ...
-- from public` da 0047 NÃO remove esses grants, porque PUBLIC e anon/
-- authenticated são papéis distintos. Como as funções são SECURITY DEFINER
-- (ignoram RLS) e recebem p_org do CHAMADOR, um usuário autenticado de
-- qualquer organização conseguiria ler e alterar execuções de outro tenant
-- chamando a RPC direto com o p_org alheio.
--
-- Mesmo padrão de revogação já usado na 0041 (comercial_handoff_confirmar):
-- guardado pela existência do papel, para continuar aplicável em Postgres puro.
do $grants$
declare
  assinatura text;
  papel text;
  assinaturas text[] := array[
    'workflow_prospeccao_agendar_espera(uuid, uuid, integer, integer, timestamptz, uuid)',
    'workflow_prospeccao_claim(uuid, uuid, integer, integer, uuid)',
    'workflow_prospeccao_liberar_claim(uuid, uuid, uuid)',
    'workflow_prospeccao_claim_publicacao(uuid, uuid, integer, uuid, timestamptz)',
    'workflow_prospeccao_confirmar_publicacao(uuid, uuid, integer, uuid)',
    'workflow_prospeccao_liberar_publicacao(uuid, uuid, integer, uuid)',
    'workflow_prospeccao_rearmar(uuid, uuid, integer)',
    'workflow_prospeccao_reconciliar_lote(uuid, uuid, integer)'
  ];
begin
  foreach assinatura in array assinaturas
  loop
    execute format('revoke all on function %s from public', assinatura);
    foreach papel in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = papel) then
        execute format('revoke all on function %s from %I', assinatura, papel);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', assinatura);
    end if;
  end loop;
end
$grants$;
