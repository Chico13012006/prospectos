-- ============================================================================
-- Migration 0024 — Trava de envio por campanha (dry_run) + vínculo execução
-- ----------------------------------------------------------------------------
-- Dois acréscimos mínimos para a Opção A do enrollment real em campanhas:
--
--   1) campanhas.dry_run (default true): gate de envio por campanha,
--      INDEPENDENTE do MODO_ENSAIO global. Ao criar uma campanha o envio
--      está bloqueado por padrão; só sai e-mail após flip explícito para false.
--
--   2) workflow_execucoes.campanha_id: referência opcional de volta à campanha
--      que originou o enrollment. O ambiente verifica este campo + campanhas.dry_run
--      antes de chamar o GmailProvider (mesmo com MODO_ENSAIO=false em prod).
--
-- 100% ADITIVA — só ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- ============================================================================

-- 1) Trava de envio por campanha.
alter table campanhas
  add column if not exists dry_run boolean not null default true;

comment on column campanhas.dry_run is
  'Gate de envio por campanha, independente do MODO_ENSAIO global. '
  'true (padrão) = bloqueia envio real. Flip para false quando o envio estiver aprovado.';

-- 2) Vínculo execução → campanha (nullable: execuções orgânicas não têm campanha).
alter table workflow_execucoes
  add column if not exists campanha_id uuid references campanhas(id) on delete set null;

create index if not exists idx_workflow_execucoes_campanha
  on workflow_execucoes(campanha_id)
  where campanha_id is not null;
