-- ============================================================================
-- Migration 0001 — Trava de migração do Motor de Automação (engine)
-- ----------------------------------------------------------------------------
-- 100% ADITIVA: só adiciona colunas, todas com DEFAULT. Não altera nem remove
-- nenhuma coluna existente, não toca em dados, não quebra o n8n nem a UI.
--
-- Idempotente: usa "if not exists", pode rodar mais de uma vez sem erro.
--
-- Reuso (NÃO criamos colunas para conceitos que já existem):
--   - estagio            -> máquina de estados do funil (já existe, texto livre)
--   - segmento           -> "nicho" do lead
--   - proxima_acao_data  -> gate de tempo de espera do follow-up
--   - ultimo_contato     -> fallback do gate
--   - perdido / perdido_motivo -> lead descartado
--   - responsavel_id     -> closer/responsável (FK usuarios)
--   - interacoes(tipo)   -> contador de follow-ups é DERIVADO daqui
-- ============================================================================

-- 1) TRAVA DE SEGURANÇA: quem é o dono do lead.
--    DEFAULT 'n8n' => TODOS os 243 leads existentes continuam com o n8n.
--    O motor novo SÓ age em leads com owner='engine'. Enquanto você não mudar
--    um lead explicitamente para 'engine', o motor não toca em nada.
alter table leads
  add column if not exists owner text not null default 'n8n'
  check (owner in ('n8n', 'engine'));

-- 2) Tese comercial: por que esse lead faz sentido (contexto entregue ao closer
--    no Fluxo 3). Nullable — leads antigos seguem sem tese, sem quebrar nada.
alter table leads
  add column if not exists tese_comercial text;

-- 3) Domínio da empresa: ajuda a casar respostas ENCAMINHADAS no Fluxo 2
--    (ex.: chefe@empresa.com.br responde por um contato cujo e-mail é pessoal).
--    Nullable — quando vazio, o motor cai para o domínio do contato_email.
alter table leads
  add column if not exists dominio text;

-- Índices leves para as consultas do motor (filtra sempre por owner + estagio).
create index if not exists idx_leads_owner   on leads(owner);
create index if not exists idx_leads_estagio on leads(estagio);

-- ----------------------------------------------------------------------------
-- COMO LIBERAR UM LEAD PARA O MOTOR (quando você quiser, manualmente):
--   update leads set owner = 'engine' where id = '<lead_id>';
-- COMO REVERTER UM LEAD PARA O N8N:
--   update leads set owner = 'n8n' where id = '<lead_id>';
-- ----------------------------------------------------------------------------
