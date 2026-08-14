-- ============================================================================
-- Migration 0026 — corrige papel de "reunião agendada" de ganho → normal
-- ----------------------------------------------------------------------------
-- "Reunião agendada" é uma etapa operacional do funil, não um estágio de
-- ganho/fechamento. Estágio de ganho é decisão de negócio por workspace e deve
-- ser configurado via Personalização > Pipeline. Esta migration remove o valor
-- hardcoded deixado pelo seed da 0014.
-- 100% idempotente (UPDATE com WHERE).
-- ============================================================================

update pipeline_estagios
set papel = 'normal'
where chave = 'reuniao_agendada'
  and papel = 'ganho';

-- Também marca sem_resposta como perdido se ainda não estiver (sanidade).
update pipeline_estagios
set papel = 'perdido'
where chave = 'sem_resposta'
  and papel != 'perdido';
