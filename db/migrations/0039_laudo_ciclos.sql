-- ============================================================================
-- 0039 — Histórico de ciclos de validade do laudo (leads.data_validade)
-- ----------------------------------------------------------------------------
-- Problema: `leads.data_validade` é um único valor por lead. Alterar a data
-- sobrescreve a anterior — não há como responder "quantos laudos venceram entre
-- março e maio" nem distinguir "renovei" de "corrigi a data".
--
-- Modelo: uma linha por CICLO do laudo de um lead.
--   * `renovado_em` NULL      = ciclo ATUAL. Seu status (vigente / próximo do
--                               vencimento / vencido) é CALCULADO pela data,
--                               nunca gravado — ver lib/laudos/ciclos.ts.
--   * `renovado_em` preenchido = ciclo HISTÓRICO, encerrado por renovação.
--
-- `leads.data_validade` continua autoritativa para o ciclo atual (cron de
-- renovação, workflows, dashboard e importação seguem lendo dela). Esta tabela
-- é o histórico ao lado; o código mantém os dois em sincronia:
--   - "Marcar como renovado": fecha o ciclo atual (renovado_em), abre um novo
--     com a nova validade e espelha em leads.data_validade.
--   - Correção manual / importação: atualiza a validade do ciclo atual (ou cria
--     o primeiro) — sem encerrar ciclo, sem histórico de renovação.
--
-- Escopo deliberado: só o fluxo de laudo baseado em leads.data_validade.
-- Não cobre servicos_recorrentes nem outros vencimentos.
--
-- Aditiva e idempotente. Multi-tenant: organizacao_id + RLS (padrão 0006/0019).
-- ============================================================================

create table if not exists laudo_ciclos (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references organizacoes(id) on delete cascade,
  lead_id         uuid not null references leads(id) on delete cascade,
  validade_em     date not null,
  -- NULL = ciclo atual; preenchido = encerrado por renovação nesta data/hora.
  renovado_em     timestamptz,
  criado_em       timestamptz not null default now()
);

-- Um único ciclo ATUAL por lead. Quem renova precisa fechar o atual antes de
-- abrir o próximo — o índice torna isso estrutural, não só convenção.
create unique index if not exists uq_laudo_ciclos_atual_por_lead
  on laudo_ciclos(lead_id)
  where renovado_em is null;

-- A consulta de negócio: "laudos que venceram entre X e Y" nesta organização.
create index if not exists idx_laudo_ciclos_org_validade
  on laudo_ciclos(organizacao_id, validade_em);

create index if not exists idx_laudo_ciclos_lead
  on laudo_ciclos(lead_id, criado_em);

-- Auto-preenchimento de organizacao_id (reusa set_org_id_default, como 0019).
drop trigger if exists trg_set_org_id on laudo_ciclos;
create trigger trg_set_org_id before insert on laudo_ciclos
  for each row execute function set_org_id_default();

-- RLS: leitura restrita à própria organização. Escrita é exclusiva das rotas
-- de servidor (service_role, que grava organizacao_id explicitamente).
alter table laudo_ciclos enable row level security;
drop policy if exists laudo_ciclos_leitura on laudo_ciclos;
create policy laudo_ciclos_leitura on laudo_ciclos
  for select
  using (organizacao_id = current_org_id());

-- ----------------------------------------------------------------------------
-- Backfill mínimo: cada lead que já tem validade ganha o seu ciclo ATUAL.
-- Idempotente (não duplica se rodar de novo). Não inventa histórico: o
-- passado anterior à migration não existe em lugar nenhum para ser recuperado.
-- ----------------------------------------------------------------------------
insert into laudo_ciclos (organizacao_id, lead_id, validade_em)
select l.organizacao_id, l.id, l.data_validade
from leads l
where l.data_validade is not null
  and not exists (
    select 1 from laudo_ciclos c
    where c.lead_id = l.id and c.renovado_em is null
  );
