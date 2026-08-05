-- ============================================================================
-- Migration 0012 — índice p/ ordenação por score (sprint item 2.8)
-- ----------------------------------------------------------------------------
-- O score deixa de ser fixo (50) e vira ordenável na Base de Leads. A coluna
-- `score` já existe; aqui só criamos um índice para a ordenação server-side por
-- organização (a Base já paginava + ordenava por outras colunas). Aditivo e
-- idempotente. O backfill dos scores dos leads que já responderam é feito por
-- script (reusa lib/engine/scoring.ts), não por SQL.
-- ============================================================================

create index if not exists idx_leads_org_score on leads(organizacao_id, score desc);
