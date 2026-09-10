-- ============================================================================
-- Migration 0035 — Persistência das mensagens inbound do WhatsApp
-- ----------------------------------------------------------------------------
-- Guarda cru o que a Meta (WhatsApp Cloud API) entrega no webhook
-- /api/webhooks/whatsapp. Só mensagens REAIS entram aqui; eventos de status
-- (entrega/leitura) são ignorados pelo código antes de chegar ao INSERT.
--
-- Por que tabela nova, e não reúso:
--   * `interacoes` exige lead_id e organizacao_id NOT NULL; esta rodada NÃO
--     vincula a lead e ainda não há como saber a organização.
--   * `mensagens_processadas` é o ledger de idempotência do monitor de E-MAIL
--     (dedup por Message-ID), propósito diferente.
--   * `contatos` é entidade de CRM, não um store de mensagens.
--
-- DECISÃO DE ARQUITETURA (aprovação pendente do Chico):
--   `organizacao_id` é NULLABLE nesta fase. O webhook é público e não tem
--   contexto de organização — não existe ainda roteamento
--   `phone_number_id -> organização`. Capturamos `phone_number_id` e
--   `display_phone_number` do payload agora (baratos de guardar, caros de
--   perder) para servir de chave desse roteamento na próxima etapa, quando a
--   vinculação com lead for feita e o `organizacao_id` for preenchido.
--   A RLS já usa a política padrão `organizacao_id = current_org_id()`, então o
--   isolamento por tenant passa a valer automaticamente após o backfill;
--   enquanto o campo é NULL, só o service_role lê (não há UI nesta rodada).
--
-- Aditiva e idempotente. Nada é apagado ou renomeado.
-- ============================================================================

create table if not exists whatsapp_mensagens (
  id uuid primary key default gen_random_uuid(),

  -- NULL nesta fase — ver decisão de arquitetura acima. Preenchido na etapa de
  -- vinculação. on delete set null: nunca perder a mensagem crua por causa de
  -- uma organização removida.
  organizacao_id uuid references organizacoes(id) on delete set null,

  -- id da mensagem na Meta (formato "wamid...."). Chave de idempotência.
  whatsapp_message_id text not null,

  -- Sempre 'inbound' nesta rodada (não enviamos nada). Coluna já existe para o
  -- dia em que houver outbound, sem migration nova.
  direcao text not null default 'inbound',

  -- Número do remetente em E.164 sem o '+' (ex.: 5511999999999), como a Meta manda.
  remetente text not null,
  -- profile.name do payload, quando a Meta inclui. Costuma vir só na 1ª mensagem.
  remetente_nome text,

  -- Tipo da Meta: text | image | audio | video | document | sticker | location
  -- | contacts | button | interactive | reaction | order | system | unsupported.
  tipo text not null,
  -- Texto extraído quando existe (text.body, caption de mídia, título de botão…).
  -- NULL para tipos sem texto (ex.: sticker). O payload cru preserva o resto.
  conteudo text,

  -- timestamp da mensagem informado pela Meta (epoch em segundos -> timestamptz).
  mensagem_em timestamptz not null,

  -- Metadados do número que RECEBEU a mensagem (metadata do payload). É a chave
  -- para rotear a mensagem à organização certa na próxima etapa.
  phone_number_id text,
  display_phone_number text,

  -- `entry[].changes[].value` cru da Meta, para auditoria e depuração.
  payload jsonb not null,

  created_at timestamptz not null default now()
);

-- IDEMPOTÊNCIA: a Meta reenvia o mesmo evento se não receber 200 a tempo. O
-- código faz INSERT ... ON CONFLICT DO NOTHING e usa a contagem de linhas para
-- saber se era novo. Duas entregas concorrentes do mesmo evento não duplicam.
create unique index if not exists uniq_whatsapp_mensagens_message_id
  on whatsapp_mensagens(whatsapp_message_id);

-- Consultas previstas: por remetente (histórico de um número) e por data.
create index if not exists idx_whatsapp_mensagens_remetente
  on whatsapp_mensagens(remetente);
create index if not exists idx_whatsapp_mensagens_created_at
  on whatsapp_mensagens(created_at);
-- Parcial: só linhas já roteadas a uma organização.
create index if not exists idx_whatsapp_mensagens_org
  on whatsapp_mensagens(organizacao_id) where organizacao_id is not null;

alter table whatsapp_mensagens enable row level security;

-- Escrita é exclusiva do webhook (service_role, que ignora RLS). Para usuário
-- autenticado a tabela é somente leitura e restrita à própria organização —
-- material de auditoria, não de operação. Linha com organizacao_id NULL não é
-- visível a nenhum tenant (NULL = current_org_id() é NULL/falso).
drop policy if exists whatsapp_mensagens_leitura on whatsapp_mensagens;
create policy whatsapp_mensagens_leitura on whatsapp_mensagens
  for select
  using (organizacao_id = current_org_id());
