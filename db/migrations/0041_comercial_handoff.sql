-- ============================================================================
-- Migration 0041 — Handoff comercial (Fase 1): distribuição round-robin
-- ----------------------------------------------------------------------------
-- Quando um lead vira oportunidade (resposta positiva, lead novo sem
-- responsável…), ele é entregue a um comercial. Fase 1 entrega SÓ o domínio:
-- quem participa do rodízio, o cursor do rodízio, o registro do handoff e a
-- primitiva atômica que confirma tudo de uma vez. Gatilhos (resposta positiva,
-- HubSpot), aviso no grupo, prazo de 7 dias etc. ficam para as fases seguintes
-- e só CONSOMEM o que está aqui.
--
-- Modelo:
--   comercial_distribuicao_participantes — quem participa do rodízio (por org).
--       Linha ausente = nunca configurado = NÃO participa. `participa=false`
--       tira do rodízio sem apagar nada (férias). NÃO mexe em ownership de
--       leads já atribuídos.
--   comercial_distribuicao_cursor — 1 linha por org: ÚLTIMO comercial que
--       recebeu lead por rodízio + `versao` (compare-and-swap). O próximo é o
--       seguinte na ordem estável (nome, id) entre os participantes ativos —
--       robusto a entrada/saída de gente no meio do ciclo.
--   comercial_handoffs — o registro do handoff (fonte da verdade). Um lead tem
--       no máximo UM handoff ABERTO (`encerrado_em is null`); reativações criam
--       um registro novo (motivo='reativacao') preservando o responsável do
--       registro anterior. `evento_id` é a identidade do evento que originou
--       (idempotência: mesmo evento → mesmo registro).
--
-- Responsável ATUAL continua sendo leads.responsavel_id (→ usuarios) — a
-- carteira/RLS (0029), CC do follow-up e closer já leem daí. A função abaixo
-- espelha o comercial escolhido nessa coluna. Responsável HISTÓRICO é o que
-- está em comercial_handoffs.
--
-- Concorrência (decisão em TS, confirmação atômica no banco):
--   comercial_handoff_confirmar() roda numa única transação com advisory lock
--   por organização + compare-and-swap em cursor.versao. Duas decisões feitas
--   sobre o mesmo estado NÃO confirmam as duas: a segunda recebe
--   'conflito_cursor' sem gravar nada e o serviço redecide. Tudo-ou-nada: se
--   qualquer passo falha, cursor, registro e lead voltam juntos.
--
-- Aditiva e idempotente (if not exists / or replace). Sem DROP, sem backfill.
-- Multi-tenant: organizacao_id em tudo + FK composta p/ usuarios (um usuário
-- de outra org não entra nem por engano) + RLS de leitura por org (escrita é
-- exclusiva do service_role, como 0030).
-- ============================================================================

-- Alvo da FK composta (usuario_id, organizacao_id): garante no schema que o
-- participante pertence à mesma organização. `id` já é PK, logo o par é único.
create unique index if not exists uniq_usuarios_id_organizacao
  on usuarios(id, organizacao_id);

-- ----------------------------------------------------------------------------
-- 1) Participantes do rodízio
-- ----------------------------------------------------------------------------
create table if not exists comercial_distribuicao_participantes (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  usuario_id uuid not null,
  participa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (organizacao_id, usuario_id),
  -- Sair da equipe (delete em usuarios) some do rodízio junto.
  foreign key (usuario_id, organizacao_id)
    references usuarios(id, organizacao_id) on delete cascade
);

drop trigger if exists trg_atualizado_em on comercial_distribuicao_participantes;
create trigger trg_atualizado_em before update on comercial_distribuicao_participantes
  for each row execute function set_atualizado_em();

-- ----------------------------------------------------------------------------
-- 2) Cursor do rodízio (1 por org)
-- ----------------------------------------------------------------------------
create table if not exists comercial_distribuicao_cursor (
  organizacao_id uuid primary key references organizacoes(id) on delete cascade,
  -- Último comercial que recebeu lead por round-robin. NULL = rodízio nunca
  -- rodou (ou o último saiu da equipe) → o próximo é o primeiro da ordem.
  ultimo_usuario_id uuid references usuarios(id) on delete set null,
  -- Compare-and-swap: cada avanço do rodízio incrementa. Quem decidiu sobre
  -- uma versão antiga não confirma.
  versao bigint not null default 0,
  atualizado_em timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3) Registro do handoff
-- ----------------------------------------------------------------------------
create table if not exists comercial_handoffs (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  -- Identidade do evento que originou o handoff (ex.: id da interação de
  -- resposta, id do objeto no HubSpot). Idempotência: mesmo evento, mesmo registro.
  evento_id text not null,
  -- Tipo de entrada (livre, tipado em TS): 'prospeccao' | 'hubspot_novo' |
  -- 'manual' … Permite distinguir as origens no futuro sem migration.
  origem text not null,
  -- Comercial que recebeu. NULL enquanto aguarda distribuição — ou se o
  -- usuário saiu da equipe depois (set null; o registro histórico sobrevive).
  responsavel_id uuid references usuarios(id) on delete set null,
  -- Como o responsável foi escolhido. NULL enquanto aguarda distribuição.
  motivo text check (motivo in ('round_robin', 'reativacao')),
  -- true = primeira vez que este lead recebe um comercial por handoff.
  primeira_atribuicao boolean,
  status text not null check (status in ('aguardando_distribuicao', 'em_contato_comercial')),
  atribuido_em timestamptz,
  -- Fases seguintes encerram o handoff (retorno ao follow-up, ganho, perda…)
  -- carimbando aqui. Enquanto NULL o handoff está aberto.
  encerrado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Coerência entre status e os campos de atribuição. responsavel_id pode
  -- voltar a NULL num registro atribuído (usuário removido da equipe), por
  -- isso não entra na checagem do lado 'em_contato_comercial'.
  constraint comercial_handoffs_status_coerente check (
    (status = 'aguardando_distribuicao'
      and responsavel_id is null and motivo is null
      and primeira_atribuicao is null and atribuido_em is null)
    or
    (status = 'em_contato_comercial'
      and motivo is not null and primeira_atribuicao is not null and atribuido_em is not null)
  )
);

-- Idempotência por evento: o mesmo evento nunca gera dois registros.
create unique index if not exists uniq_comercial_handoffs_evento
  on comercial_handoffs(organizacao_id, lead_id, evento_id);

-- No máximo UM handoff aberto por lead (aguardando ou em contato). É o que
-- impede redistribuir um lead já em contato comercial, mesmo sob corrida.
create unique index if not exists uniq_comercial_handoffs_aberto_por_lead
  on comercial_handoffs(organizacao_id, lead_id)
  where encerrado_em is null;

-- "Responsável histórico" do lead = registro mais recente com responsável.
create index if not exists idx_comercial_handoffs_lead_historico
  on comercial_handoffs(organizacao_id, lead_id, criado_em desc);

-- Consultas futuras por comercial (carteira de handoffs, 7 dias, métricas).
create index if not exists idx_comercial_handoffs_responsavel
  on comercial_handoffs(organizacao_id, responsavel_id)
  where encerrado_em is null;

drop trigger if exists trg_atualizado_em on comercial_handoffs;
create trigger trg_atualizado_em before update on comercial_handoffs
  for each row execute function set_atualizado_em();

-- ----------------------------------------------------------------------------
-- 4) RLS — leitura por organização; escrita só pelo service_role (ignora RLS).
--    Mesmo padrão da 0030: material de auditoria/config, não de operação
--    direta pelo browser.
-- ----------------------------------------------------------------------------
do $rls$
declare t text; pol record;
begin
  foreach t in array array[
    'comercial_distribuicao_participantes',
    'comercial_distribuicao_cursor',
    'comercial_handoffs'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop execute format('drop policy %I on %I', pol.policyname, t); end loop;
    execute format(
      'create policy %I on %I for select using (organizacao_id = current_org_id())',
      t || '_leitura', t);
  end loop;
end
$rls$;

-- ----------------------------------------------------------------------------
-- 5) Primitiva atômica: confirma um handoff decidido pelo serviço.
-- ----------------------------------------------------------------------------
-- Entrada = a decisão (quem, por quê, sobre qual versão do cursor). Saída =
-- jsonb { resultado, handoff }. Resultados CONTROLADOS (nada gravado):
--   'ja_processado'            mesmo evento já concluído antes
--   'ja_em_contato_comercial'  outro evento; lead já tem handoff em contato
--   'lead_nao_encontrado'      lead não existe NESTA organização
--   'participante_inelegivel'  o escolhido saiu do rodízio/equipe no meio
--   'conflito_cursor'          outra distribuição avançou o cursor antes
-- Resultados que GRAVAM (tudo na mesma transação):
--   'confirmado'               registro + cursor (se round_robin) + lead
--   'aguardando_distribuicao'  registro pendente, sem responsável (recuperável)
--
-- Advisory lock por organização serializa as confirmações da org (as checagens
-- abaixo ficam livres de corrida entre si). O CAS em cursor.versao cobre a
-- decisão feita FORA do lock: quem decidiu sobre estado velho não confirma.
-- Qualquer exceção desfaz tudo (função = uma transação).
create or replace function comercial_handoff_confirmar(
  p_organizacao_id uuid,
  p_lead_id uuid,
  p_evento_id text,
  p_origem text,
  p_responsavel_id uuid,            -- null → aguardando_distribuicao
  p_motivo text,                    -- 'round_robin' | 'reativacao' | null
  p_primeira_atribuicao boolean,    -- null quando aguardando
  p_cursor_versao_esperada bigint   -- só para round_robin
)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_aberto comercial_handoffs%rowtype;
  v_registro comercial_handoffs%rowtype;
  v_nome text;
  v_linhas integer;
begin
  if p_organizacao_id is null or p_lead_id is null or coalesce(p_evento_id, '') = '' then
    raise exception 'comercial_handoff_confirmar: organizacao_id, lead_id e evento_id são obrigatórios';
  end if;
  if p_responsavel_id is not null and p_motivo not in ('round_robin', 'reativacao') then
    raise exception 'comercial_handoff_confirmar: motivo inválido (%)', p_motivo;
  end if;

  -- Serializa por organização (mesmo padrão da 0018 por empresa).
  perform pg_advisory_xact_lock(hashtextextended('comercial_handoff:' || p_organizacao_id::text, 0));

  -- Lead precisa existir NESTA org — nunca atribui lead de outro tenant.
  if not exists (select 1 from leads where id = p_lead_id and organizacao_id = p_organizacao_id) then
    return jsonb_build_object('resultado', 'lead_nao_encontrado');
  end if;

  -- Handoff aberto do lead (no máximo um, garantido pelo índice parcial).
  select * into v_aberto
    from comercial_handoffs
   where organizacao_id = p_organizacao_id and lead_id = p_lead_id and encerrado_em is null
   limit 1;

  if v_aberto.id is not null and v_aberto.status = 'em_contato_comercial' then
    return jsonb_build_object(
      'resultado', case when v_aberto.evento_id = p_evento_id then 'ja_processado' else 'ja_em_contato_comercial' end,
      'handoff', to_jsonb(v_aberto));
  end if;

  -- Sem responsável: registra (ou mantém) o pendente. Não toca cursor nem lead.
  if p_responsavel_id is null then
    if v_aberto.id is not null then
      return jsonb_build_object('resultado', 'aguardando_distribuicao', 'handoff', to_jsonb(v_aberto));
    end if;
    insert into comercial_handoffs (organizacao_id, lead_id, evento_id, origem, status)
    values (p_organizacao_id, p_lead_id, p_evento_id, p_origem, 'aguardando_distribuicao')
    returning * into v_registro;
    return jsonb_build_object('resultado', 'aguardando_distribuicao', 'handoff', to_jsonb(v_registro));
  end if;

  -- Escolhido ainda é elegível? (round_robin: participa + ativo; reativacao:
  -- basta existir ativo na org — pode estar fora do rodízio de propósito.)
  select u.nome into v_nome
    from usuarios u
   where u.id = p_responsavel_id and u.organizacao_id = p_organizacao_id and u.ativo = true
     and (p_motivo = 'reativacao' or exists (
       select 1 from comercial_distribuicao_participantes p
        where p.organizacao_id = p_organizacao_id and p.usuario_id = u.id and p.participa));
  if v_nome is null then
    return jsonb_build_object('resultado', 'participante_inelegivel');
  end if;

  -- Round-robin avança o cursor por compare-and-swap. Reativação não avança.
  if p_motivo = 'round_robin' then
    insert into comercial_distribuicao_cursor (organizacao_id)
    values (p_organizacao_id) on conflict (organizacao_id) do nothing;

    update comercial_distribuicao_cursor
       set ultimo_usuario_id = p_responsavel_id, versao = versao + 1, atualizado_em = now()
     where organizacao_id = p_organizacao_id
       and versao = coalesce(p_cursor_versao_esperada, -1);
    get diagnostics v_linhas = row_count;
    if v_linhas = 0 then
      return jsonb_build_object('resultado', 'conflito_cursor');
    end if;
  end if;

  -- Registro: completa o pendente (se houver) ou cria o novo.
  if v_aberto.id is not null then
    update comercial_handoffs
       set responsavel_id = p_responsavel_id, motivo = p_motivo,
           primeira_atribuicao = coalesce(p_primeira_atribuicao, true),
           status = 'em_contato_comercial', atribuido_em = now()
     where id = v_aberto.id and organizacao_id = p_organizacao_id
    returning * into v_registro;
  else
    insert into comercial_handoffs (
      organizacao_id, lead_id, evento_id, origem, responsavel_id, motivo,
      primeira_atribuicao, status, atribuido_em)
    values (
      p_organizacao_id, p_lead_id, p_evento_id, p_origem, p_responsavel_id, p_motivo,
      coalesce(p_primeira_atribuicao, true), 'em_contato_comercial', now())
    returning * into v_registro;
  end if;

  -- Espelha o responsável ATUAL no lead (carteira/RLS, CC, closer leem daqui).
  update leads
     set responsavel_id = p_responsavel_id, responsavel_nome = v_nome
   where id = p_lead_id and organizacao_id = p_organizacao_id;
  get diagnostics v_linhas = row_count;
  if v_linhas = 0 then
    -- Não deveria acontecer (checado acima, sob lock); se acontecer, desfaz tudo.
    raise exception 'comercial_handoff_confirmar: lead % sumiu durante a confirmação', p_lead_id;
  end if;

  return jsonb_build_object('resultado', 'confirmado', 'handoff', to_jsonb(v_registro));
end
$fn$;

-- Só o service_role (motor/rotas) confirma handoffs. No Supabase os default
-- privileges dão EXECUTE a anon/authenticated em toda função nova — revoga
-- explicitamente (guardado pela existência do papel, para rodar em Postgres puro).
do $grants$
declare r text;
begin
  revoke all on function comercial_handoff_confirmar(uuid, uuid, text, text, uuid, text, boolean, bigint) from public;
  foreach r in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function comercial_handoff_confirmar(uuid, uuid, text, text, uuid, text, boolean, bigint) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function comercial_handoff_confirmar(uuid, uuid, text, text, uuid, text, boolean, bigint) to service_role;
  end if;
end
$grants$;
