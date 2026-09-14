-- ============================================================================
-- Migration 0042 — Handoff comercial (Fase 2): notificações do handoff
-- ----------------------------------------------------------------------------
-- O handoff (comercial_handoffs, 0041) é a fonte da verdade. Avisar o grupo
-- comercial no WhatsApp é um EFEITO separado e recuperável: esta tabela é o
-- outbox mínimo que registra a intenção de notificar, quantas vezes tentou, o
-- que deu errado e quando saiu. Assim dá para distinguir "handoff realizado,
-- alerta ainda não enviado" e reprocessar sem tocar no handoff (nem no cursor).
--
-- Por que tabela nova: `notificacoes` (0020) é a caixa in-app do usuário (canal
-- app|email com CHECK, sem status/tentativas) e a fila Vercel só acorda
-- processamentos — nenhuma das duas guarda estado de entrega.
--
-- Identidade única = (handoff_id, tipo): o mesmo handoff nunca gera duas
-- intenções do mesmo tipo, mesmo com evento duplicado. Ciclo de vida:
--   pendente → enviando → enviada
--                      ↘ falhou (retentável até o teto de tentativas)
--   configuracao_ausente (grupo não configurado; volta a pendente ao reprocessar
--                         quando a configuração existir)
-- `enviando` que nunca virou enviada/falhou (processo morreu entre o envio e a
-- marcação) NÃO é reenviado automaticamente — fica visível para decisão humana,
-- porque reenviar poderia duplicar a mensagem no grupo.
--
-- Aditiva e idempotente. Multi-tenant: organizacao_id + RLS de leitura por org
-- (escrita só pelo service_role, como 0030/0041).
-- ============================================================================

create table if not exists comercial_handoff_notificacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  handoff_id uuid not null references comercial_handoffs(id) on delete cascade,
  tipo text not null check (tipo in ('grupo_comercial')),
  status text not null default 'pendente'
    check (status in ('pendente', 'enviando', 'enviada', 'falhou', 'configuracao_ausente')),
  -- Quantas vezes o envio foi de fato tentado no provedor.
  tentativas integer not null default 0,
  ultimo_erro text,
  -- Dados congelados no momento do handoff para montar a mensagem (empresa,
  -- contato, responsável, etapa da cadência, motivo). Reprocessar depois monta
  -- o MESMO texto, mesmo que o lead mude.
  dados jsonb not null default '{}'::jsonb,
  -- Para onde foi (id do grupo) e o id que o provedor devolveu — auditoria.
  destino text,
  provider_message_id text,
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint comercial_handoff_notificacoes_enviada_coerente check (
    status <> 'enviada' or enviado_em is not null
  )
);

-- A trava de duplicidade: uma intenção por handoff e tipo.
create unique index if not exists uniq_comercial_handoff_notificacoes_handoff_tipo
  on comercial_handoff_notificacoes(handoff_id, tipo);

-- Reprocessamento: só o que ainda não saiu.
create index if not exists idx_comercial_handoff_notificacoes_pendentes
  on comercial_handoff_notificacoes(organizacao_id, status)
  where status <> 'enviada';

drop trigger if exists trg_atualizado_em on comercial_handoff_notificacoes;
create trigger trg_atualizado_em before update on comercial_handoff_notificacoes
  for each row execute function set_atualizado_em();

do $rls$
declare pol record;
begin
  alter table comercial_handoff_notificacoes enable row level security;
  for pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'comercial_handoff_notificacoes'
  loop execute format('drop policy %I on comercial_handoff_notificacoes', pol.policyname); end loop;
  create policy comercial_handoff_notificacoes_leitura on comercial_handoff_notificacoes
    for select using (organizacao_id = current_org_id());
end
$rls$;
