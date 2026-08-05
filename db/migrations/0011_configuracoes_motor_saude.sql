-- ============================================================================
-- Migration 0011 — telemetria de saúde do cron de follow-up (sprint item 2.5)
-- ----------------------------------------------------------------------------
-- Guarda, por organização, o timestamp da ÚLTIMA execução bem-sucedida do
-- follow-up e do último alerta enviado (dedup, p/ não spammar). O limite de
-- horas sem rodar é configurável (followup_alerta_horas); nulo = usa o default
-- do código (env FOLLOWUP_ALERTA_HORAS ou 26h).
--
-- Fica em configuracoes_motor (já é 1 linha por org, PK organizacao_id). Aditivo
-- e idempotente: colunas nullable, IF NOT EXISTS.
-- ============================================================================

alter table configuracoes_motor add column if not exists followup_ultima_execucao timestamptz;
alter table configuracoes_motor add column if not exists followup_ultimo_alerta timestamptz;
alter table configuracoes_motor add column if not exists followup_alerta_horas int;
