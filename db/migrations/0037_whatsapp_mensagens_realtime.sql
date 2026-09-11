-- ============================================================================
-- Migration 0037 — whatsapp_mensagens na publicação do Supabase Realtime
-- ----------------------------------------------------------------------------
-- A Central de Respostas assina `postgres_changes` (INSERT) em
-- `whatsapp_mensagens` para reler as conversas sem F5. O Realtime só emite
-- eventos de tabelas que estão na publicação `supabase_realtime` — e a
-- publicação deste projeto não tinha NENHUMA tabela (verificado em
-- pg_publication_tables): o canal assinava, mas nunca recebia nada.
--
-- O que muda: SÓ a inclusão da tabela na publicação. Nada mais.
--   * RLS/policies intactas — o Realtime avalia a policy de SELECT
--     (`organizacao_id = current_org_id()`, migration 0035) com o JWT de cada
--     assinante; linha de outra organização ou sem vínculo (organizacao_id NULL)
--     não é entregue a ninguém.
--   * REPLICA IDENTITY permanece `default` — suficiente para INSERT, que é o
--     único evento consumido.
--   * Sem trigger, sem coluna, sem índice, sem outra tabela.
--
-- Idempotente: só adiciona se ainda não estiver na publicação (ADD TABLE
-- repetido falharia com "already member"). Reversão: ALTER PUBLICATION
-- supabase_realtime DROP TABLE public.whatsapp_mensagens.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_mensagens'
  ) then
    alter publication supabase_realtime
      add table public.whatsapp_mensagens;
  end if;
end $$;
