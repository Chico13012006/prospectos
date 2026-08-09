-- ============================================================================
-- Migration 0013 — A/B testing de templates (item 6)
-- ----------------------------------------------------------------------------
-- Registra QUAL template (variante) o motor usou em cada envio, para medir a
-- taxa de resposta por variante. Aditivo e nullable: envios antigos e interações
-- manuais ficam com template_id = null (não entram no A/B). FK para templates
-- com ON DELETE SET NULL (apagar um template não apaga o histórico da interação).
-- O índice acelera a agregação por variante na Inteligência Comercial.
-- ============================================================================

alter table interacoes
  add column if not exists template_id uuid references templates(id) on delete set null;

create index if not exists idx_interacoes_template on interacoes(template_id) where template_id is not null;
