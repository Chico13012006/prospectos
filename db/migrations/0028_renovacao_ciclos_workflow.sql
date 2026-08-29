-- ============================================================================
-- Migration 0028 — ciclos recorrentes de renovação no motor de workflows
-- ----------------------------------------------------------------------------
-- Permite que o MESMO lead percorra novamente o workflow de renovação em um
-- vencimento futuro, sem duplicar a execução do ciclo atual.
--
-- `ciclo_chave` identifica o ciclo de negócio (empresa/lead + mês do
-- vencimento). `servico_id` mantém a rastreabilidade até o laudo/serviço que
-- originou a automação. Campos nulos preservam todas as execuções legadas.
-- ============================================================================

alter table workflow_execucoes
  add column if not exists ciclo_chave text,
  add column if not exists servico_id uuid references servicos_recorrentes(id) on delete set null;

create unique index if not exists uq_workflow_execucoes_ciclo_renovacao
  on workflow_execucoes(organizacao_id, workflow_id, lead_id, ciclo_chave)
  where ciclo_chave is not null and lead_id is not null;

create index if not exists idx_workflow_execucoes_servico
  on workflow_execucoes(organizacao_id, servico_id)
  where servico_id is not null;

comment on column workflow_execucoes.ciclo_chave is
  'Idempotência de processos recorrentes. Em renovação: empresa/lead + competência do vencimento.';
