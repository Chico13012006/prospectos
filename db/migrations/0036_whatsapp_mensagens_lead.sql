-- ============================================================================
-- Migration 0036 — Vínculo da mensagem inbound do WhatsApp com o lead
-- ----------------------------------------------------------------------------
-- Etapa seguinte à 0035 (que criou `whatsapp_mensagens` com `organizacao_id`
-- NULLABLE). Agora, ao receber uma mensagem inbound, o webhook tenta localizar
-- o lead dono do telefone e grava `lead_id` + `organizacao_id` na mensagem.
--
-- O que muda no schema: só uma coluna nova, aditiva.
--   * `lead_id` — FK para `leads(id)`, NULLABLE. Fica NULL quando nenhum lead
--     casa o telefone OU quando mais de um lead casa (ambiguidade → sem escolha
--     arbitrária; ver lib/whatsapp/inbound.ts).
--   * `on delete set null` — igual ao `organizacao_id` da mesma tabela: a
--     mensagem crua nunca é perdida por causa de um lead removido.
--
-- `organizacao_id` CONTINUA NULLABLE nesta rodada (não vira NOT NULL). Ele
-- passa a ser preenchido junto com `lead_id`, a partir do `organizacao_id` do
-- lead casado — nunca de payload do cliente. A política de RLS de leitura
-- (`organizacao_id = current_org_id()`, definida na 0035) já cobre as linhas
-- que ganharem organização.
--
-- SEM backfill nesta migration: mensagens já gravadas com lead_id/organizacao_id
-- NULL permanecem assim; um backfill dirigido é decisão à parte.
--
-- Idempotente. Nada é apagado ou renomeado.
-- ============================================================================

alter table whatsapp_mensagens
  add column if not exists lead_id uuid references leads(id) on delete set null;

-- Consulta prevista: "mensagens deste lead". Parcial — só linhas já vinculadas.
create index if not exists idx_whatsapp_mensagens_lead_id
  on whatsapp_mensagens(lead_id) where lead_id is not null;
