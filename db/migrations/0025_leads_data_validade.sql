-- ============================================================================
-- Migration 0025 — leads.data_validade (data de validade do laudo/certificação)
-- ----------------------------------------------------------------------------
-- Campo opcional para registrar a data de vencimento do laudo técnico do lead.
-- Usado pela condição `campo / nao_vazio` do motor de workflows para ramificar
-- cadências de renovação/reativação (toque 3 vs 3B do workflow de reativação).
-- 100% ADITIVA — só ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- ============================================================================

alter table leads
  add column if not exists data_validade date;

comment on column leads.data_validade is
  'Data de validade do laudo/certificação do lead. '
  'Usada pelo motor de workflows para ramificar por vencimento.';

create index if not exists idx_leads_data_validade
  on leads(data_validade)
  where data_validade is not null;
