-- ============================================================================
-- Migration 0002 — nome do responsável (texto livre)
-- ----------------------------------------------------------------------------
-- O CSV do HubSpot traz o "Proprietário do contato" como NOME (ex.: "Silmara
-- Gonçalves"), que não casa com usuarios.id (uuid). Guardamos o nome cru aqui.
-- Aditiva, nullable, idempotente — não quebra nada.
-- ============================================================================

alter table leads add column if not exists responsavel_nome text;
