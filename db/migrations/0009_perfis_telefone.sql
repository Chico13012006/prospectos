-- ============================================================================
-- Migration 0009 — telefone no perfil do usuário (sprint item 2.3)
-- ----------------------------------------------------------------------------
-- Adiciona `telefone` (nullable, aditivo) à tabela `perfis`, que é onde o
-- formulário "Meu Perfil" (app/meu-perfil + /api/perfil) já persiste os dados
-- do usuário logado (nome, nicho, avatar). Sem default e nullable: não toca
-- nenhuma linha existente.
--
-- Idempotente: IF NOT EXISTS.
-- ============================================================================

alter table perfis add column if not exists telefone text;
