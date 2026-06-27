-- ============================================================================
-- Migration 0003 — contador denormalizado de follow-ups (followups_enviados)
-- ----------------------------------------------------------------------------
-- A fonte da verdade continua sendo `interacoes` (tipo='follow_up',
-- origem_acao='ia'), como na 0001. Aqui materializamos a CONTAGEM numa coluna
-- em `leads` para que a visão "Cadência de Follow-up" possa agrupar por número
-- de follow-up (1º/2º/3º/4º) com COUNT + range paginado e índice — sem agregar
-- `interacoes` a cada consulta. O motor passa a manter esta coluna em dia
-- (lib/engine/flows/followUp.ts) ao enviar cada follow-up.
--
-- Aditiva, idempotente, com DEFAULT 0 — não quebra n8n nem a UI.
-- ============================================================================

-- 1) Coluna-cache. DEFAULT 0 => leads existentes começam zerados e são
--    corrigidos pelo backfill abaixo.
alter table leads
  add column if not exists followups_enviados int not null default 0;

-- 2) Backfill: conta os follow-ups já enviados pelo motor (origem_acao='ia') por
--    lead e grava na coluna. Idempotente — pode rodar de novo a qualquer momento.
update leads l
set followups_enviados = coalesce(f.n, 0)
from (
  select lead_id, count(*)::int as n
  from interacoes
  where tipo = 'follow_up' and origem_acao = 'ia'
  group by lead_id
) f
where f.lead_id = l.id
  and l.followups_enviados is distinct from coalesce(f.n, 0);

-- 3) Índice para o agrupamento por etapa + número de follow-up (colunas da
--    Cadência filtram por estagio e followups_enviados juntos).
create index if not exists idx_leads_estagio_followups
  on leads (estagio, followups_enviados);
