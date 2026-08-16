-- ============================================================================
-- Migration 0027 — bounce de e-mail por lead (P0 — BaseLaudos)
-- ----------------------------------------------------------------------------
-- Quando o motor detecta um bounce SMTP (undeliverable, mailer-daemon, etc.)
-- para um lead, marca o lead como bounced + carimbo. Lead bounced:
--   • sai da esteira automática (filtro em leadsParaFollowup)
--   • não pode ser inscrito em nova campanha (filtro no enrollment)
--   • suas execuções ativas de workflow são canceladas imediatamente
--
-- Mesmo padrão de optout (migration 0010): flag dedicada, não depende de
-- estagio (que pode ser revertido manualmente depois).
-- ============================================================================

alter table leads add column if not exists bounced boolean not null default false;
alter table leads add column if not exists bounced_em timestamptz;

-- Índice parcial: varredura de leadsParaFollowup ignora bounced rapidamente.
create index if not exists idx_leads_bounced on leads(organizacao_id) where bounced = true;
