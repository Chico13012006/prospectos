-- ============================================================================
-- Migration 0044 — Handoff comercial (Fase 4): resposta do grupo ao check-in
-- ----------------------------------------------------------------------------
-- O grupo comercial responde ao check-in com um comando determinístico
-- ("#CODIGO 1" continuar comigo / "#CODIGO 2" voltar para follow-up) e a
-- ProspectOS executa a decisão. Quatro coisas pequenas e aditivas:
--
--  1. comercial_handoff_notificacoes.codigo_ref — referência CURTA e ÚNICA por
--     organização, gerada quando a intenção do check-in é criada e impressa na
--     mensagem. É a única correlação aceita (nunca nome de empresa/comercial,
--     nunca "última mensagem do grupo"). Colisão é impossível de executar: o
--     índice único a impede de existir.
--  2. comercial_handoffs.encerrado_motivo — por que o handoff foi encerrado
--     (Fase 4: 'retorno_followup'). Texto livre tipado em TS (como `origem`),
--     para fases futuras não exigirem migration a cada motivo novo.
--  3. comercial_grupo_comandos — auditoria + idempotência dos comandos do grupo:
--     organização, grupo, handoff, messageId da Z-API, remetente (telefone,
--     só auditoria — nenhum vínculo usuário→telefone é afirmado), comando,
--     quando chegou e o resultado. unique(organizacao_id, provider_message_id)
--     é o que impede executar duas vezes o mesmo callback reenviado.
--  4. organizacoes: índice único no grupo comercial configurado — duas
--     organizações NUNCA apontam para o mesmo grupo (o callback de grupo não
--     traz organizacao_id; o grupo é o único caminho para a org, então tem de
--     ser inequívoco no schema, não só na UI).
--
-- "Voltar para follow-up" NÃO precisa de coluna nova: a execução do workflow
-- de retorno leva ciclo_chave = 'handoff_retorno:<handoff_id>' (0028), que é a
-- identidade do ciclo (idempotência da inscrição) E a origem explícita que a
-- Fase 2 usa para distinguir follow-up de retorno de follow-up importado.
--
-- Aditiva e idempotente. Multi-tenant + RLS de leitura (escrita só service_role).
-- ============================================================================

alter table comercial_handoff_notificacoes
  add column if not exists codigo_ref text;

create unique index if not exists uniq_comercial_handoff_notificacoes_codigo
  on comercial_handoff_notificacoes(organizacao_id, codigo_ref)
  where codigo_ref is not null;

alter table comercial_handoffs
  add column if not exists encerrado_motivo text;

create table if not exists comercial_grupo_comandos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  grupo_id text not null,
  -- messageId do ReceivedCallback da Z-API: identidade estável do evento.
  provider_message_id text not null,
  -- Quem escreveu no grupo (participantPhone) — auditoria, não autorização.
  remetente text,
  remetente_nome text,
  texto text not null,
  codigo_ref text,
  comando text check (comando in ('1', '2')),
  handoff_id uuid references comercial_handoffs(id) on delete set null,
  notificacao_id uuid references comercial_handoff_notificacoes(id) on delete set null,
  -- recebido → processando → concluido | ignorado | falhou (retentável)
  status text not null default 'recebido'
    check (status in ('recebido', 'processando', 'concluido', 'ignorado', 'falhou')),
  -- O que aconteceu: continuar | retorno_followup | codigo_desconhecido |
  -- comando_invalido | handoff_nao_aberto | sem_campanha_retorno | ...
  resultado text,
  erro text,
  recebido_em timestamptz not null,
  processado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists uniq_comercial_grupo_comandos_mensagem
  on comercial_grupo_comandos(organizacao_id, provider_message_id);

create index if not exists idx_comercial_grupo_comandos_handoff
  on comercial_grupo_comandos(organizacao_id, handoff_id);

-- Reprocesso: só o que não terminou.
create index if not exists idx_comercial_grupo_comandos_pendentes
  on comercial_grupo_comandos(organizacao_id, status)
  where status in ('recebido', 'processando', 'falhou');

drop trigger if exists trg_atualizado_em on comercial_grupo_comandos;
create trigger trg_atualizado_em before update on comercial_grupo_comandos
  for each row execute function set_atualizado_em();

do $rls$
declare pol record;
begin
  alter table comercial_grupo_comandos enable row level security;
  for pol in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'comercial_grupo_comandos'
  loop execute format('drop policy %I on comercial_grupo_comandos', pol.policyname); end loop;
  create policy comercial_grupo_comandos_leitura on comercial_grupo_comandos
    for select using (organizacao_id = current_org_id());
end
$rls$;

-- Um grupo comercial pertence a NO MÁXIMO uma organização.
create unique index if not exists uniq_organizacoes_grupo_comercial
  on organizacoes ((configuracoes -> 'comercial' ->> 'grupoWhatsappId'))
  where (configuracoes -> 'comercial' ->> 'grupoWhatsappId') is not null;
