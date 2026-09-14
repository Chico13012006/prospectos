-- ============================================================================
-- Migration 0043 — Handoff comercial (Fase 3): tipo de notificação 'handoff_checkin'
-- ----------------------------------------------------------------------------
-- O check-in de acompanhamento ("@Bruno, como ficou o lead X?") reutiliza o
-- outbox da 0042 (comercial_handoff_notificacoes): mesma tabela, mesma
-- identidade única (handoff_id, tipo), mesmo ciclo pendente → enviando →
-- enviada | falhou | configuracao_ausente, mesmo compare-and-swap. A ÚNICA
-- coisa que a 0042 não comporta é o valor novo no CHECK de `tipo` — esta
-- migration só alarga esse CHECK. Nenhuma coluna ou tabela nova: "check-in
-- enviado" é a linha (handoff_id, 'handoff_checkin') com status 'enviada'.
--
-- O relógio do check-in é comercial_handoffs.atribuido_em (Fase 1); a janela
-- fica em organizacoes.configuracoes.comercial.handoffRevisaoMinutos (padrão
-- 10080 = 7 dias), resolvida no servidor — nada aqui.
--
-- Aditiva e idempotente: drop if exists + add (nome do CHECK inline gerado
-- pelo Postgres na 0042: <tabela>_tipo_check). Não remove nenhum valor.
-- ============================================================================

alter table comercial_handoff_notificacoes
  drop constraint if exists comercial_handoff_notificacoes_tipo_check;
alter table comercial_handoff_notificacoes
  add constraint comercial_handoff_notificacoes_tipo_check
  check (tipo in ('grupo_comercial', 'handoff_checkin'));
