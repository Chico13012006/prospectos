-- ============================================================================
-- Migration 0021 — Fase 4.5: responsável no serviço recorrente
-- ----------------------------------------------------------------------------
-- Aditiva. responsavel_id (convenção usuarios.id, sem FK rígida — mesmo padrão
-- de leads/tarefas). A renovação usa este responsável quando definido; senão cai
-- no responsável do lead da empresa.
-- ============================================================================
alter table servicos_recorrentes add column if not exists responsavel_id uuid;
