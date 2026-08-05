-- ============================================================================
-- Migration 0010 — opt-out de follow-up por lead (sprint item 2.4)
-- ----------------------------------------------------------------------------
-- Quando o contato clica em "não quero mais receber" no rodapé do follow-up, o
-- lead sai PERMANENTEMENTE da esteira automática. Marcamos com uma flag dedicada
-- (`optout`) + carimbo (`optout_em`). O motor passa a excluir optout=true de
-- leadsParaFollowup; a rota pública também move o estágio p/ 'descartado' (some
-- do board ativo), mas a flag é a fonte de verdade da trava — não depende do
-- estágio poder ser mexido depois.
--
-- Aditivo e idempotente: colunas nullable/default, IF NOT EXISTS. Não toca
-- nenhuma linha existente (todas nascem optout=false).
-- ============================================================================

alter table leads add column if not exists optout boolean not null default false;
alter table leads add column if not exists optout_em timestamptz;

-- Filtro do motor (leadsParaFollowup) bate em optout=false; índice parcial ajuda
-- a varredura a ignorar os que já saíram.
create index if not exists idx_leads_optout on leads(organizacao_id) where optout = true;
