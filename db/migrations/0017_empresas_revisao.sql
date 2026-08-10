-- ============================================================================
-- Migration 0017 — Fase 2b: campos estruturados de revisão pendente em empresas
-- ----------------------------------------------------------------------------
-- 100% ADITIVA e idempotente. O backfill (política conservadora) NUNCA mescla
-- por nome isolado ou domínio isolado — casos ambíguos ficam SEPARADOS e são
-- marcados aqui, em campos ESTRUTURADOS (não só em observações livres):
--   revisao_pendente boolean  — precisa de revisão humana de identidade
--   motivo_revisao   text     — por quê (ex.: domínio compartilhado por nomes
--                                distintos = possível filial; nome repetido sem
--                                domínio para confirmar).
-- Permite filtrar/priorizar a fila de revisão sem parsear texto livre.
-- ============================================================================

alter table empresas add column if not exists revisao_pendente boolean not null default false;
alter table empresas add column if not exists motivo_revisao text;

-- Índice parcial: a fila de revisão (poucas linhas) é consultada por este flag.
create index if not exists idx_empresas_revisao_pendente
  on empresas(organizacao_id)
  where revisao_pendente;
