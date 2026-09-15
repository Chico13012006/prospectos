-- ============================================================================
-- Migration 0045 — Propostas comerciais salvas
-- ----------------------------------------------------------------------------
-- Até aqui o Simulador (Comercial) só "registrava" a proposta como uma nota de
-- texto em `interacoes`: não havia como listar, baixar de novo nem enviar ao
-- cliente. Nasce a entidade `propostas_comerciais`:
--   * valores FINAIS negociados + referências da tabela (internas) + total;
--   * `dados_pdf` = snapshot exato do que o PDF desenha (lib/proposta/dados),
--     para baixar/enviar depois a MESMA proposta, sem recalcular nada;
--   * rastro do envio ao cliente (canal, destino, quando, quantas vezes) e
--     `envio_iniciado_em`, a trava que impede dois envios simultâneos.
--
-- Por que não `propostas`: o banco de produção já tem uma tabela `propostas`
-- criada FORA das migrations (colunas titulo/modelo_implantacao/quantidade_*,
-- 1 linha na época desta migration), sem uso no código. Ela não é tocada aqui;
-- reaproveitar o nome faria o `create table if not exists` ser ignorado.
--
-- Notas antigas "Proposta comercial (...)" em `interacoes` continuam onde estão
-- (sem backfill: são texto livre, sem itens estruturados confiáveis).
--
-- Multi-tenant: organizacao_id NOT NULL em toda linha. Leitura pelo browser via
-- RLS acompanhando a visibilidade do lead (mesma regra de `interacoes`, 0029:
-- admin vê a organização; comercial só a própria carteira). Escrita exclusiva
-- do service_role (rotas /api/propostas), que filtra organizacao_id
-- explicitamente.
--
-- Aditiva e idempotente. Rollback: `drop table if exists propostas_comerciais;`
-- (nenhuma outra tabela depende dela).
-- ============================================================================

create table if not exists propostas_comerciais (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  modelo text not null check (modelo in ('compra', 'comodato')),
  -- [{ "produto": "coletor", "qtd": 1 }, ...] — ids de lib/simulador.ts.
  itens jsonb not null check (jsonb_typeof(itens) = 'array'),
  -- Valores FINAIS negociados (compra usa valor_final; comodato, mensal/entrada).
  valor_final numeric(12, 2) not null default 0,
  mensal_final numeric(12, 2) not null default 0,
  entrada_final numeric(12, 2) not null default 0,
  prazo_meses integer check (prazo_meses is null or prazo_meses > 0),
  -- Referências da tabela oficial no momento da proposta. Uso interno: nunca
  -- vão para o PDF. Recalculadas no servidor, não confiadas ao browser.
  valor_tabela numeric(12, 2) not null default 0,
  mensal_tabela numeric(12, 2) not null default 0,
  entrada_tabela numeric(12, 2) not null default 0,
  total numeric(12, 2) not null check (total >= 0),
  dados_pdf jsonb not null,
  status text not null default 'salva' check (status in ('salva', 'enviada')),
  -- Quem salvou (perfis.id da sessão). Sem FK: remover alguém da equipe não
  -- pode travar nem apagar o histórico comercial; o nome fica congelado.
  criado_por uuid,
  criado_por_nome text,
  enviada_em timestamptz,
  enviada_canal text check (enviada_canal in ('email', 'whatsapp')),
  enviada_para text,
  envios integer not null default 0 check (envios >= 0),
  -- Trava de envio: carimbada antes de chamar o provedor e limpa ao concluir.
  -- Um carimbo com mais de 2 minutos é considerado abandonado (ver
  -- lib/propostas/enviarPropostaServidor.ts).
  envio_iniciado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint propostas_comerciais_envio_coerente check (
    (status = 'salva' and enviada_em is null and enviada_canal is null and envios = 0)
    or
    (status = 'enviada' and enviada_em is not null and enviada_canal is not null and envios > 0)
  )
);

-- Aba Propostas do lead (mais recentes primeiro, desempate por id).
create index if not exists idx_propostas_comerciais_org_lead
  on propostas_comerciais(organizacao_id, lead_id, criado_em desc, id desc);

-- Aba Propostas do Comercial (lista da organização, paginada).
create index if not exists idx_propostas_comerciais_org_criado
  on propostas_comerciais(organizacao_id, criado_em desc, id desc);

drop trigger if exists trg_atualizado_em on propostas_comerciais;
create trigger trg_atualizado_em before update on propostas_comerciais
  for each row execute function set_atualizado_em();

-- ----------------------------------------------------------------------------
-- RLS — só leitura pelo browser, acompanhando a carteira do lead. O subselect
-- em `leads` passa pela política leads_carteira (0029): proposta de lead fora
-- da carteira do comercial não aparece. Sem política de escrita: insert/update
-- só pelo service_role.
-- ----------------------------------------------------------------------------
alter table propostas_comerciais enable row level security;
drop policy if exists propostas_comerciais_leitura on propostas_comerciais;
create policy propostas_comerciais_leitura on propostas_comerciais
  for select
  using (
    organizacao_id = current_org_id()
    and (
      current_profile_role() = 'admin'
      or exists (
        select 1 from leads l
         where l.id = propostas_comerciais.lead_id
           and l.organizacao_id = propostas_comerciais.organizacao_id
      )
    )
  );

-- PostgREST passa a enxergar a tabela nova sem esperar o recarregamento.
notify pgrst, 'reload schema';
