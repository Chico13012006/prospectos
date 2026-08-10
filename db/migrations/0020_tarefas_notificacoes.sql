-- ============================================================================
-- Migration 0020 — Fase 4: tarefas (1ª classe) + notificacoes
-- ----------------------------------------------------------------------------
-- Tarefa deixa de ser nota em `interacoes` e vira ENTIDADE, com responsável,
-- status, prioridade, prazo, origem e motivo. Pode referenciar lead/empresa/
-- contato/serviço (todos nullable — a tarefa vive por si). notificacoes é o
-- registro estruturado de avisos (in-app/email) com destinatário, origem,
-- motivo e leitura. Multi-tenant: organizacao_id + RLS (padrão 0006/0008).
--
-- responsavel_id fica SEM FK rígida (uuid): por convenção é usuarios.id (mesmo
-- alvo de leads.responsavel_id), mas o vínculo é frouxo no schema atual — manter
-- assim evita acoplar a uma tabela enquanto a resolução responsável↔usuário
-- ainda é por e-mail/heurística. Ver [[leads-responsavel-data-model]].
-- ============================================================================

create table if not exists tarefas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  lead_id uuid references leads(id) on delete set null,
  empresa_id uuid references empresas(id) on delete set null,
  contato_id uuid references contatos(id) on delete set null,
  servico_id uuid references servicos_recorrentes(id) on delete set null,
  tipo text,                       -- 'renovacao'|'ligacao'|'manual'|... (livre)
  titulo text not null,
  descricao text,
  responsavel_id uuid,             -- convenção: usuarios.id (sem FK rígida)
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'cancelada')),
  prioridade text not null default 'media' check (prioridade in ('baixa', 'media', 'alta')),
  prazo_em timestamptz,
  origem text,                     -- 'workflow'|'renovacao'|'manual'|...
  motivo text,
  concluido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_tarefas_organizacao on tarefas(organizacao_id);
create index if not exists idx_tarefas_responsavel on tarefas(organizacao_id, responsavel_id);
create index if not exists idx_tarefas_status on tarefas(organizacao_id, status);
create index if not exists idx_tarefas_prazo on tarefas(organizacao_id, prazo_em) where status <> 'concluida';
create index if not exists idx_tarefas_lead on tarefas(lead_id);

create table if not exists notificacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  perfil_id uuid references perfis(id) on delete cascade,  -- destinatário in-app
  email text,                       -- destinatário e-mail / ponte
  canal text not null default 'app' check (canal in ('app', 'email')),
  titulo text,
  mensagem text,
  lead_id uuid references leads(id) on delete set null,
  tarefa_id uuid references tarefas(id) on delete cascade,
  origem text,                      -- 'workflow'|'renovacao'|'campanha'|...
  motivo text,
  link text,
  lida boolean not null default false,
  lida_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists idx_notificacoes_destinatario on notificacoes(organizacao_id, perfil_id, lida);
create index if not exists idx_notificacoes_criado on notificacoes(organizacao_id, criado_em);

-- Auto-org + RLS nas duas tabelas.
do $mt$
declare t text;
begin
  foreach t in array array['tarefas', 'notificacoes']
  loop
    execute format('drop trigger if exists trg_set_org_id on %I', t);
    execute format('create trigger trg_set_org_id before insert on %I for each row execute function set_org_id_default()', t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I for all using (organizacao_id = current_org_id()) with check (organizacao_id = current_org_id())', t || '_tenant', t);
  end loop;
end
$mt$;
