-- ============================================================================
-- Migration 0000 — Schema base (gerado por pg_dump --schema-only)
-- ----------------------------------------------------------------------------
-- Versiona o schema que nenhuma migration criava (leads, interacoes, usuarios,
-- perfis, templates e outras). Antes disso a 0001 já começava com
-- "alter table leads" e o banco não podia ser reconstruído do repositório.
--
-- Gerado com: pg_dump --schema-only --no-owner --no-acl --schema=public
-- Servidor de origem: PostgreSQL 17.6. Contém apenas DDL, zero INSERT/COPY.
--
-- IDEMPOTENTE: table/index/sequence com "if not exists"; function/trigger com
-- "or replace"; policy precedida de "drop policy if exists"; constraint dentro
-- de bloco DO com EXCEPTION duplicate_object. Pode rodar mais de uma vez.
--
-- PRÉ-REQUISITOS fora deste arquivo (vivem fora do schema public):
--   - schema "auth" do Supabase  -> auth.uid(), auth.jwt(), FK para auth.users
--   - schema "extensions"        -> extensions.uuid_generate_v4()
-- Portanto: aplica sobre um projeto Supabase novo. NÃO reconstrói sobre um
-- PostgreSQL puro que não tenha esses schemas.
--
-- OMITIDO DELIBERADAMENTE:
--   - trigger "prospectOS-novo-lead" em public.leads, que chamava
--     supabase_functions.http_request apontando para o n8n. Depende do schema
--     supabase_functions (fora deste dump) e é removido pela migration 0049.
--     Mantê-lo aqui quebraria o rebuild do zero.
-- ============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;

SET lock_timeout = 0;

SET idle_in_transaction_session_timeout = 0;

SET transaction_timeout = 0;

SET client_encoding = 'UTF8';

SET standard_conforming_strings = on;

SELECT pg_catalog.set_config('search_path', '', false);

SET check_function_bodies = false;

SET xmloption = content;

SET client_min_messages = warning;

SET row_security = off;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';

--
-- Name: calc_vencimento_servico(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.calc_vencimento_servico() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.realizado_em is null or new.periodicidade_valor is null or new.periodicidade_unidade is null then
    new.vencimento_em := null;
  elsif new.periodicidade_unidade = 'dias' then
    new.vencimento_em := (new.realizado_em + make_interval(days => new.periodicidade_valor))::date;
  elsif new.periodicidade_unidade = 'meses' then
    new.vencimento_em := (new.realizado_em + make_interval(months => new.periodicidade_valor))::date;
  elsif new.periodicidade_unidade = 'anos' then
    new.vencimento_em := (new.realizado_em + make_interval(years => new.periodicidade_valor))::date;
  else
    new.vencimento_em := null;
  end if;
  new.atualizado_em := now();
  return new;
end
$$;

--
-- Name: comercial_handoff_confirmar(uuid, uuid, text, text, uuid, text, boolean, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.comercial_handoff_confirmar(p_organizacao_id uuid, p_lead_id uuid, p_evento_id text, p_origem text, p_responsavel_id uuid, p_motivo text, p_primeira_atribuicao boolean, p_cursor_versao_esperada bigint) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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
$$;

--
-- Name: current_commercial_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.current_commercial_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.id
    from usuarios u
   where u.organizacao_id = current_org_id()
     and u.ativo = true
     and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by u.id
   limit 1
$$;

--
-- Name: current_commercial_user_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.current_commercial_user_name() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.nome
    from usuarios u
   where u.id = current_commercial_user_id()
$$;

--
-- Name: current_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select organizacao_id from perfis where id = auth.uid()
$$;

--
-- Name: current_profile_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.current_profile_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role from perfis where id = auth.uid()
$$;

--
-- Name: impedir_troca_organizacao_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.impedir_troca_organizacao_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.organizacao_id is distinct from old.organizacao_id then
    raise exception 'organizacao_id não pode ser alterado (%).', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end
$$;

--
-- Name: set_atualizado_em(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.set_atualizado_em() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.atualizado_em := now();
  return new;
end
$$;

--
-- Name: set_org_id_default(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.set_org_id_default() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.organizacao_id is null then
    new.organizacao_id := current_org_id();
  end if;
  return new;
end
$$;

--
-- Name: sync_lead_para_entidades(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.sync_lead_para_entidades() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  contato_mudou boolean;
  empresa_mudou boolean;
begin
  -- Anti-loop: a propagação aos leads irmãos (abaixo) re-dispara este trigger;
  -- em profundidade > 1 não fazemos nada.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  contato_mudou := new.contato_id is not null and (
    new.contato_nome is distinct from old.contato_nome or
    new.contato_cargo is distinct from old.contato_cargo or
    new.contato_email is distinct from old.contato_email or
    new.contato_telefone is distinct from old.contato_telefone);

  empresa_mudou := new.empresa_id is not null and (
    new.empresa  is distinct from old.empresa  or
    new.cidade   is distinct from old.cidade   or
    new.estado   is distinct from old.estado   or
    new.segmento is distinct from old.segmento or
    new.site     is distinct from old.site     or
    new.dominio  is distinct from old.dominio);

  -- CONTATO ligado (1:1 com o lead).
  if contato_mudou then
    update contatos set
      nome     = new.contato_nome,
      cargo    = new.contato_cargo,
      email    = new.contato_email,
      telefone = new.contato_telefone,
      atualizado_em = now(),
      sync_origem_lead_id = new.id,
      sync_em = now()
    where id = new.contato_id and organizacao_id = new.organizacao_id;
  end if;

  -- EMPRESA compartilhada (1 empresa : N leads).
  if empresa_mudou then
    -- Serializa o sync desta empresa entre transações concorrentes (evita
    -- deadlock da propagação cruzada e garante consistência).
    perform pg_advisory_xact_lock(hashtextextended(new.empresa_id::text, 0));

    update empresas set
      nome     = new.empresa,
      cidade   = new.cidade,
      estado   = new.estado,
      segmento = new.segmento,
      site     = new.site,
      dominio  = new.dominio,
      atualizado_em = now(),
      sync_origem_lead_id = new.id,
      sync_em = now()
    where id = new.empresa_id and organizacao_id = new.organizacao_id;

    -- Consistência: os DEMAIS leads da mesma empresa recebem os mesmos campos
    -- compartilhados (nunca toca pipeline/estado/histórico). Só quando difere.
    update leads set
      empresa  = new.empresa,
      cidade   = new.cidade,
      estado   = new.estado,
      segmento = new.segmento,
      site     = new.site,
      dominio  = new.dominio
    where empresa_id = new.empresa_id
      and organizacao_id = new.organizacao_id
      and id <> new.id
      and (empresa  is distinct from new.empresa  or
           cidade   is distinct from new.cidade   or
           estado   is distinct from new.estado   or
           segmento is distinct from new.segmento or
           site     is distinct from new.site     or
           dominio  is distinct from new.dominio);
  end if;

  return new;
end
$$;

--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: workflow_execucoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workflow_execucoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    versao_id uuid NOT NULL,
    lead_id uuid,
    passo_atual integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'em_andamento'::text NOT NULL,
    proxima_verificacao_em timestamp with time zone,
    iniciado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    campanha_id uuid,
    ciclo_chave text,
    servico_id uuid,
    agendamento_geracao integer DEFAULT 0 NOT NULL,
    agendamento_publicado_em timestamp with time zone,
    agendamento_checkpoint_em timestamp with time zone,
    publicacao_token uuid,
    publicacao_expira_em timestamp with time zone,
    claim_token uuid,
    claim_expira_em timestamp with time zone,
    CONSTRAINT workflow_execucoes_status_check CHECK ((status = ANY (ARRAY['em_andamento'::text, 'aguardando'::text, 'concluido'::text, 'erro'::text, 'cancelado'::text])))
);

--
-- Name: COLUMN workflow_execucoes.ciclo_chave; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workflow_execucoes.ciclo_chave IS 'Idempotência de processos recorrentes. Em renovação: empresa/lead + competência do vencimento.';

--
-- Name: workflow_prospeccao_agendar_espera(uuid, uuid, integer, integer, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_agendar_espera(p_org uuid, p_id uuid, p_passo_esperado integer, p_proximo_passo integer, p_ate timestamp with time zone, p_claim_token uuid DEFAULT NULL::uuid) RETURNS SETOF public.workflow_execucoes
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes e set
    passo_atual = p_proximo_passo, status = 'aguardando',
    proxima_verificacao_em = p_ate, agendamento_geracao = e.agendamento_geracao + 1,
    agendamento_publicado_em = null, agendamento_checkpoint_em = null,
    publicacao_token = null, publicacao_expira_em = null,
    claim_token = null, claim_expira_em = null, atualizado_em = now()
  where e.organizacao_id = p_org and e.id = p_id
    and e.passo_atual = p_passo_esperado
    and e.status in ('em_andamento', 'aguardando')
    and (
      (p_claim_token is not null and e.claim_token = p_claim_token and e.claim_expira_em > now())
      or (p_claim_token is null and e.status = 'em_andamento' and e.claim_token is null)
    )
    and exists (select 1 from campanhas c where c.id = e.campanha_id
      and c.organizacao_id = p_org and c.tipo = 'prospeccao')
  returning e.*;
$$;

--
-- Name: workflow_prospeccao_claim(uuid, uuid, integer, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_claim(p_org uuid, p_id uuid, p_geracao integer, p_passo integer, p_token uuid) RETURNS SETOF public.workflow_execucoes
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes e set claim_token = p_token,
    claim_expira_em = now() + interval '10 minutes'
  where e.organizacao_id = p_org and e.id = p_id
    and e.status = 'aguardando' and e.passo_atual = p_passo
    and e.agendamento_geracao = p_geracao
    and e.proxima_verificacao_em <= now()
    and (e.claim_token is null or e.claim_expira_em <= now())
    and exists (select 1 from campanhas c where c.id = e.campanha_id
      and c.organizacao_id = p_org and c.tipo = 'prospeccao')
  returning e.*;
$$;

--
-- Name: workflow_prospeccao_claim_publicacao(uuid, uuid, integer, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_claim_publicacao(p_org uuid, p_id uuid, p_geracao integer, p_token uuid, p_checkpoint timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_id uuid;
begin
  update workflow_execucoes e set publicacao_token = p_token,
    publicacao_expira_em = now() + interval '5 minutes',
    agendamento_checkpoint_em = p_checkpoint
  where e.organizacao_id = p_org and e.id = p_id
    and e.status = 'aguardando' and e.agendamento_geracao = p_geracao
    and e.agendamento_publicado_em is null
    and (e.publicacao_token is null or e.publicacao_expira_em <= now())
    and exists (select 1 from campanhas c where c.id = e.campanha_id
      and c.organizacao_id = p_org and c.tipo = 'prospeccao')
  returning e.id into v_id;
  return v_id is not null;
end $$;

--
-- Name: workflow_prospeccao_confirmar_publicacao(uuid, uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_confirmar_publicacao(p_org uuid, p_id uuid, p_geracao integer, p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes set agendamento_publicado_em = now(),
    publicacao_token = null, publicacao_expira_em = null
  where organizacao_id = p_org and id = p_id
    and agendamento_geracao = p_geracao and publicacao_token = p_token;
$$;

--
-- Name: workflow_prospeccao_liberar_claim(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_liberar_claim(p_org uuid, p_id uuid, p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes set claim_token = null, claim_expira_em = null
  where organizacao_id = p_org and id = p_id and claim_token = p_token;
$$;

--
-- Name: workflow_prospeccao_liberar_publicacao(uuid, uuid, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_liberar_publicacao(p_org uuid, p_id uuid, p_geracao integer, p_token uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes set publicacao_token = null,
    publicacao_expira_em = null, agendamento_checkpoint_em = null
  where organizacao_id = p_org and id = p_id
    and agendamento_geracao = p_geracao and publicacao_token = p_token;
$$;

--
-- Name: workflow_prospeccao_rearmar(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_rearmar(p_org uuid, p_id uuid, p_geracao integer) RETURNS SETOF public.workflow_execucoes
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update workflow_execucoes e set agendamento_geracao = e.agendamento_geracao + 1,
    agendamento_publicado_em = null, agendamento_checkpoint_em = null,
    publicacao_token = null, publicacao_expira_em = null,
    claim_token = null, claim_expira_em = null
  where e.organizacao_id = p_org and e.id = p_id
    and e.status = 'aguardando' and e.agendamento_geracao = p_geracao
    and (e.claim_token is null or e.claim_expira_em <= now())
    and exists (select 1 from campanhas c where c.id = e.campanha_id
      and c.organizacao_id = p_org and c.tipo = 'prospeccao')
  returning e.*;
$$;

--
-- Name: workflow_prospeccao_reconciliar_lote(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.workflow_prospeccao_reconciliar_lote(p_org uuid, p_depois uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 100) RETURNS SETOF public.workflow_execucoes
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select e.* from workflow_execucoes e
  join campanhas c on c.id = e.campanha_id and c.organizacao_id = p_org
  where e.organizacao_id = p_org and c.tipo = 'prospeccao'
    and c.status in ('ativa', 'concluida')
    and e.status = 'aguardando'
    and (p_depois is null or e.id > p_depois)
    and (e.proxima_verificacao_em <= now()
      or (e.agendamento_geracao > 0 and e.agendamento_publicado_em is null)
      or (e.agendamento_checkpoint_em is not null and e.agendamento_checkpoint_em <= now())
      or (e.claim_token is not null and e.claim_expira_em <= now()))
  order by e.id limit least(greatest(p_limite, 1), 200);
$$;

--
-- Name: campanhas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.campanhas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    nome text NOT NULL,
    descricao text,
    tipo text,
    status text DEFAULT 'rascunho'::text NOT NULL,
    workflow_id uuid,
    publico jsonb DEFAULT '{}'::jsonb NOT NULL,
    meta_leads integer,
    iniciada_em timestamp with time zone,
    concluida_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    CONSTRAINT campanhas_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'ativa'::text, 'pausada'::text, 'concluida'::text])))
);

--
-- Name: COLUMN campanhas.dry_run; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.campanhas.dry_run IS 'Gate de envio por campanha, independente do MODO_ENSAIO global. true (padrão) = bloqueia envio real. Flip para false quando o envio estiver aprovado.';

--
-- Name: comercial_distribuicao_cursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.comercial_distribuicao_cursor (
    organizacao_id uuid NOT NULL,
    ultimo_usuario_id uuid,
    versao bigint DEFAULT 0 NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: comercial_distribuicao_participantes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.comercial_distribuicao_participantes (
    organizacao_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    participa boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: comercial_grupo_comandos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.comercial_grupo_comandos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    grupo_id text NOT NULL,
    provider_message_id text NOT NULL,
    remetente text,
    remetente_nome text,
    texto text NOT NULL,
    codigo_ref text,
    comando text,
    handoff_id uuid,
    notificacao_id uuid,
    status text DEFAULT 'recebido'::text NOT NULL,
    resultado text,
    erro text,
    recebido_em timestamp with time zone NOT NULL,
    processado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comercial_grupo_comandos_comando_check CHECK ((comando = ANY (ARRAY['1'::text, '2'::text]))),
    CONSTRAINT comercial_grupo_comandos_status_check CHECK ((status = ANY (ARRAY['recebido'::text, 'processando'::text, 'concluido'::text, 'ignorado'::text, 'falhou'::text])))
);

--
-- Name: comercial_handoff_notificacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.comercial_handoff_notificacoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    handoff_id uuid NOT NULL,
    tipo text NOT NULL,
    status text DEFAULT 'pendente'::text NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    ultimo_erro text,
    dados jsonb DEFAULT '{}'::jsonb NOT NULL,
    destino text,
    provider_message_id text,
    enviado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    codigo_ref text,
    CONSTRAINT comercial_handoff_notificacoes_enviada_coerente CHECK (((status <> 'enviada'::text) OR (enviado_em IS NOT NULL))),
    CONSTRAINT comercial_handoff_notificacoes_status_check CHECK ((status = ANY (ARRAY['pendente'::text, 'enviando'::text, 'enviada'::text, 'falhou'::text, 'configuracao_ausente'::text]))),
    CONSTRAINT comercial_handoff_notificacoes_tipo_check CHECK ((tipo = ANY (ARRAY['grupo_comercial'::text, 'handoff_checkin'::text])))
);

--
-- Name: comercial_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.comercial_handoffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    evento_id text NOT NULL,
    origem text NOT NULL,
    responsavel_id uuid,
    motivo text,
    primeira_atribuicao boolean,
    status text NOT NULL,
    atribuido_em timestamp with time zone,
    encerrado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    encerrado_motivo text,
    CONSTRAINT comercial_handoffs_motivo_check CHECK ((motivo = ANY (ARRAY['round_robin'::text, 'reativacao'::text]))),
    CONSTRAINT comercial_handoffs_status_check CHECK ((status = ANY (ARRAY['aguardando_distribuicao'::text, 'em_contato_comercial'::text]))),
    CONSTRAINT comercial_handoffs_status_coerente CHECK ((((status = 'aguardando_distribuicao'::text) AND (responsavel_id IS NULL) AND (motivo IS NULL) AND (primeira_atribuicao IS NULL) AND (atribuido_em IS NULL)) OR ((status = 'em_contato_comercial'::text) AND (motivo IS NOT NULL) AND (primeira_atribuicao IS NOT NULL) AND (atribuido_em IS NOT NULL))))
);

--
-- Name: configuracoes_motor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.configuracoes_motor (
    id smallint,
    max_envios_dia integer DEFAULT 40 NOT NULL,
    horas_entre_followups integer DEFAULT 48 NOT NULL,
    max_followups integer DEFAULT 3 NOT NULL,
    intervalo_entre_envios_min integer DEFAULT 0 NOT NULL,
    dias_semana_ativos text DEFAULT '1,2,3,4,5'::text NOT NULL,
    closer_email_fallback text,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_por text,
    organizacao_id uuid NOT NULL,
    followup_ultima_execucao timestamp with time zone,
    followup_ultimo_alerta timestamp with time zone,
    followup_alerta_horas integer
);

--
-- Name: contatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.contatos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid,
    nome text,
    cargo text,
    email text,
    email_validado boolean DEFAULT false NOT NULL,
    telefone text,
    whatsapp text,
    linkedin text,
    senioridade text,
    origem text,
    observacoes text,
    arquivado boolean DEFAULT false NOT NULL,
    arquivado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    sync_origem_lead_id uuid,
    sync_em timestamp with time zone
);

--
-- Name: empresas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.empresas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    nome text NOT NULL,
    cnpj text,
    dominio text,
    segmento text,
    cidade text,
    estado text,
    pais text,
    site text,
    telefone text,
    faixa_funcionarios text,
    origem text,
    observacoes text,
    arquivado boolean DEFAULT false NOT NULL,
    arquivado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    revisao_pendente boolean DEFAULT false NOT NULL,
    motivo_revisao text,
    sync_origem_lead_id uuid,
    sync_em timestamp with time zone
);

--
-- Name: interacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.interacoes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    tipo text NOT NULL,
    canal text,
    descricao text,
    origem_acao text DEFAULT 'ia'::text,
    responsavel_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    organizacao_id uuid NOT NULL,
    template_id uuid,
    motivo text
);

--
-- Name: laudo_ciclos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.laudo_ciclos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    validade_em date NOT NULL,
    renovado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.leads (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    empresa text NOT NULL,
    cidade text,
    estado text,
    segmento text,
    faixa_funcionarios text,
    site text,
    linkedin text,
    contato_nome text,
    contato_cargo text,
    contato_email text,
    contato_telefone text,
    canal_preferencial text DEFAULT 'email'::text,
    estagio text DEFAULT 'novos_leads'::text,
    score integer DEFAULT 0,
    responsavel_id uuid,
    ultimo_contato timestamp with time zone,
    proxima_acao text,
    proxima_acao_data timestamp with time zone,
    origem text DEFAULT 'hubspot'::text,
    hubspot_id text,
    perdido boolean DEFAULT false,
    perdido_motivo text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    owner text DEFAULT 'n8n'::text NOT NULL,
    tese_comercial text,
    dominio text,
    responsavel_nome text,
    followups_enviados integer DEFAULT 0 NOT NULL,
    organizacao_id uuid NOT NULL,
    optout boolean DEFAULT false NOT NULL,
    optout_em timestamp with time zone,
    empresa_id uuid,
    contato_id uuid,
    data_validade date,
    bounced boolean DEFAULT false NOT NULL,
    bounced_em timestamp with time zone,
    CONSTRAINT leads_owner_check CHECK ((owner = ANY (ARRAY['n8n'::text, 'engine'::text])))
);

--
-- Name: COLUMN leads.data_validade; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.data_validade IS 'Data de validade do laudo/certificação do lead. Usada pelo motor de workflows para ramificar por vencimento.';

--
-- Name: mensagens_processadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.mensagens_processadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    mensagem_id text NOT NULL,
    resultado text,
    lead_id uuid,
    processado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: notificacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.notificacoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    perfil_id uuid,
    email text,
    canal text DEFAULT 'app'::text NOT NULL,
    titulo text,
    mensagem text,
    lead_id uuid,
    tarefa_id uuid,
    origem text,
    motivo text,
    link text,
    lida boolean DEFAULT false NOT NULL,
    lida_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notificacoes_canal_check CHECK ((canal = ANY (ARRAY['app'::text, 'email'::text])))
);

--
-- Name: oportunidades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.oportunidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    lead_id uuid,
    empresa_id uuid,
    contato_id uuid,
    servico_id uuid,
    pipeline_id uuid,
    estagio_id uuid,
    titulo text NOT NULL,
    valor numeric(14,2),
    moeda text DEFAULT 'BRL'::text NOT NULL,
    probabilidade integer,
    status text DEFAULT 'aberta'::text NOT NULL,
    origem text,
    motivo_perda text,
    responsavel_id uuid,
    previsao_fechamento date,
    fechada_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT oportunidades_probabilidade_check CHECK (((probabilidade >= 0) AND (probabilidade <= 100))),
    CONSTRAINT oportunidades_status_check CHECK ((status = ANY (ARRAY['aberta'::text, 'ganha'::text, 'perdida'::text])))
);

--
-- Name: organizacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.organizacoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    slug text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    nicho text,
    configuracoes jsonb DEFAULT '{}'::jsonb NOT NULL
);

--
-- Name: perfil_permissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.perfil_permissoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    perfil_id uuid NOT NULL,
    permissao text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: perfis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.perfis (
    id uuid NOT NULL,
    nome text,
    role text DEFAULT 'usuario'::text NOT NULL,
    nicho text,
    created_at timestamp with time zone DEFAULT now(),
    avatar_url text,
    organizacao_id uuid NOT NULL,
    telefone text,
    CONSTRAINT perfis_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'usuario'::text])))
);

--
-- Name: pipeline_estagios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pipeline_estagios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    chave text NOT NULL,
    nome text NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    cor text,
    papel text DEFAULT 'normal'::text NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_estagios_papel_check CHECK ((papel = ANY (ARRAY['inicial'::text, 'normal'::text, 'ganho'::text, 'perdido'::text])))
);

--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    nome text NOT NULL,
    tipo text DEFAULT 'prospeccao'::text NOT NULL,
    descricao text,
    ativo boolean DEFAULT true NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: propostas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.propostas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    titulo text NOT NULL,
    modelo_implantacao integer NOT NULL,
    quantidade_coletores integer DEFAULT 0 NOT NULL,
    quantidade_kits_impressora integer DEFAULT 0 NOT NULL,
    quantidade_totens integer DEFAULT 0 NOT NULL,
    quantidade_pdvs integer DEFAULT 0 NOT NULL,
    valor_entrada numeric(14,2) NOT NULL,
    valor_mensalidade numeric(14,2) NOT NULL,
    criado_por uuid,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT propostas_modelo_implantacao_check CHECK ((modelo_implantacao = ANY (ARRAY[1, 2]))),
    CONSTRAINT propostas_quantidade_coletores_check CHECK ((quantidade_coletores >= 0)),
    CONSTRAINT propostas_quantidade_kits_impressora_check CHECK ((quantidade_kits_impressora >= 0)),
    CONSTRAINT propostas_quantidade_pdvs_check CHECK ((quantidade_pdvs >= 0)),
    CONSTRAINT propostas_quantidade_totens_check CHECK ((quantidade_totens >= 0)),
    CONSTRAINT propostas_titulo_check CHECK (((char_length(TRIM(BOTH FROM titulo)) >= 1) AND (char_length(TRIM(BOTH FROM titulo)) <= 180))),
    CONSTRAINT propostas_valor_entrada_check CHECK ((valor_entrada >= (0)::numeric)),
    CONSTRAINT propostas_valor_mensalidade_check CHECK ((valor_mensalidade >= (0)::numeric))
);

--
-- Name: propostas_comerciais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.propostas_comerciais (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    modelo text NOT NULL,
    itens jsonb NOT NULL,
    valor_final numeric(12,2) DEFAULT 0 NOT NULL,
    mensal_final numeric(12,2) DEFAULT 0 NOT NULL,
    entrada_final numeric(12,2) DEFAULT 0 NOT NULL,
    prazo_meses integer,
    valor_tabela numeric(12,2) DEFAULT 0 NOT NULL,
    mensal_tabela numeric(12,2) DEFAULT 0 NOT NULL,
    entrada_tabela numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    dados_pdf jsonb NOT NULL,
    status text DEFAULT 'salva'::text NOT NULL,
    criado_por uuid,
    criado_por_nome text,
    enviada_em timestamp with time zone,
    enviada_canal text,
    enviada_para text,
    envios integer DEFAULT 0 NOT NULL,
    envio_iniciado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT propostas_comerciais_enviada_canal_check CHECK ((enviada_canal = ANY (ARRAY['email'::text, 'whatsapp'::text]))),
    CONSTRAINT propostas_comerciais_envio_coerente CHECK ((((status = 'salva'::text) AND (enviada_em IS NULL) AND (enviada_canal IS NULL) AND (envios = 0)) OR ((status = 'enviada'::text) AND (enviada_em IS NOT NULL) AND (enviada_canal IS NOT NULL) AND (envios > 0)))),
    CONSTRAINT propostas_comerciais_envios_check CHECK ((envios >= 0)),
    CONSTRAINT propostas_comerciais_itens_check CHECK ((jsonb_typeof(itens) = 'array'::text)),
    CONSTRAINT propostas_comerciais_modelo_check CHECK ((modelo = ANY (ARRAY['compra'::text, 'comodato'::text]))),
    CONSTRAINT propostas_comerciais_prazo_meses_check CHECK (((prazo_meses IS NULL) OR (prazo_meses > 0))),
    CONSTRAINT propostas_comerciais_status_check CHECK ((status = ANY (ARRAY['salva'::text, 'enviada'::text]))),
    CONSTRAINT propostas_comerciais_total_check CHECK ((total >= (0)::numeric))
);

--
-- Name: servicos_recorrentes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.servicos_recorrentes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    tipo text,
    realizado_em date,
    periodicidade_valor integer,
    periodicidade_unidade text,
    vencimento_em date,
    status text DEFAULT 'vigente'::text NOT NULL,
    observacoes text,
    origem text,
    arquivado boolean DEFAULT false NOT NULL,
    arquivado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    responsavel_id uuid,
    CONSTRAINT servicos_recorrentes_periodicidade_unidade_check CHECK ((periodicidade_unidade = ANY (ARRAY['dias'::text, 'meses'::text, 'anos'::text]))),
    CONSTRAINT servicos_recorrentes_status_check CHECK ((status = ANY (ARRAY['vigente'::text, 'vencido'::text, 'renovado'::text, 'cancelado'::text])))
);

--
-- Name: tarefas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.tarefas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    lead_id uuid,
    empresa_id uuid,
    contato_id uuid,
    servico_id uuid,
    tipo text,
    titulo text NOT NULL,
    descricao text,
    responsavel_id uuid,
    status text DEFAULT 'aberta'::text NOT NULL,
    prioridade text DEFAULT 'media'::text NOT NULL,
    prazo_em timestamp with time zone,
    origem text,
    motivo text,
    concluido_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tarefas_prioridade_check CHECK ((prioridade = ANY (ARRAY['baixa'::text, 'media'::text, 'alta'::text]))),
    CONSTRAINT tarefas_status_check CHECK ((status = ANY (ARRAY['aberta'::text, 'em_andamento'::text, 'concluida'::text, 'cancelada'::text])))
);

--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    nome text NOT NULL,
    tipo text NOT NULL,
    canal text DEFAULT 'email'::text NOT NULL,
    nicho text,
    assunto text,
    corpo text NOT NULL,
    taxa_resposta numeric(5,2) DEFAULT 0,
    ativo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    organizacao_id uuid NOT NULL,
    html text,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    criado_por uuid,
    atualizado_por uuid,
    CONSTRAINT templates_canal_valido CHECK ((canal = ANY (ARRAY['email'::text, 'whatsapp'::text, 'linkedin'::text, 'telefone'::text]))),
    CONSTRAINT templates_html_limite CHECK (((html IS NULL) OR (octet_length(html) <= 200000))),
    CONSTRAINT templates_html_somente_email CHECK (((html IS NULL) OR (canal = 'email'::text)))
);

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usuarios (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    nome text NOT NULL,
    email text NOT NULL,
    cargo text DEFAULT 'SDR'::text,
    avatar_iniciais text,
    avatar_cor text DEFAULT '#7F77DD'::text,
    avatar_bg text DEFAULT '#EEEDFE'::text,
    ativo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    organizacao_id uuid NOT NULL
);

--
-- Name: whatsapp_mensagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.whatsapp_mensagens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid,
    whatsapp_message_id text NOT NULL,
    direcao text DEFAULT 'inbound'::text NOT NULL,
    remetente text NOT NULL,
    remetente_nome text,
    tipo text NOT NULL,
    conteudo text,
    mensagem_em timestamp with time zone NOT NULL,
    phone_number_id text,
    display_phone_number text,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lead_id uuid
);

--
-- Name: workflow_execucao_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workflow_execucao_eventos (
    id bigint NOT NULL,
    organizacao_id uuid NOT NULL,
    execucao_id uuid NOT NULL,
    tipo text NOT NULL,
    detalhe jsonb,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: workflow_execucao_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.workflow_execucao_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: workflow_execucao_eventos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_execucao_eventos_id_seq OWNED BY public.workflow_execucao_eventos.id;

--
-- Name: workflow_versoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workflow_versoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    numero integer NOT NULL,
    definicao jsonb NOT NULL,
    publicado_em timestamp with time zone DEFAULT now() NOT NULL,
    publicado_por uuid
);

--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    nome text NOT NULL,
    status text DEFAULT 'rascunho'::text NOT NULL,
    versao_atual_id uuid,
    rascunho_definicao jsonb,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflows_status_check CHECK ((status = ANY (ARRAY['rascunho'::text, 'publicado'::text, 'pausado'::text])))
);

--
-- Name: workflow_execucao_eventos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execucao_eventos ALTER COLUMN id SET DEFAULT nextval('public.workflow_execucao_eventos_id_seq'::regclass);

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'campanhas' AND c.conname = 'campanhas_pkey'
  ) THEN
    ALTER TABLE ONLY public.campanhas
        ADD CONSTRAINT campanhas_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_cursor' AND c.conname = 'comercial_distribuicao_cursor_pkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_cursor
        ADD CONSTRAINT comercial_distribuicao_cursor_pkey PRIMARY KEY (organizacao_id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_participantes' AND c.conname = 'comercial_distribuicao_participantes_pkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_participantes
        ADD CONSTRAINT comercial_distribuicao_participantes_pkey PRIMARY KEY (organizacao_id, usuario_id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_grupo_comandos' AND c.conname = 'comercial_grupo_comandos_pkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_grupo_comandos
        ADD CONSTRAINT comercial_grupo_comandos_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoff_notificacoes' AND c.conname = 'comercial_handoff_notificacoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoff_notificacoes
        ADD CONSTRAINT comercial_handoff_notificacoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoffs' AND c.conname = 'comercial_handoffs_pkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoffs
        ADD CONSTRAINT comercial_handoffs_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'configuracoes_motor' AND c.conname = 'configuracoes_motor_org_pk'
  ) THEN
    ALTER TABLE ONLY public.configuracoes_motor
        ADD CONSTRAINT configuracoes_motor_org_pk PRIMARY KEY (organizacao_id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'contatos' AND c.conname = 'contatos_pkey'
  ) THEN
    ALTER TABLE ONLY public.contatos
        ADD CONSTRAINT contatos_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'empresas' AND c.conname = 'empresas_pkey'
  ) THEN
    ALTER TABLE ONLY public.empresas
        ADD CONSTRAINT empresas_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'interacoes' AND c.conname = 'interacoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.interacoes
        ADD CONSTRAINT interacoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'laudo_ciclos' AND c.conname = 'laudo_ciclos_pkey'
  ) THEN
    ALTER TABLE ONLY public.laudo_ciclos
        ADD CONSTRAINT laudo_ciclos_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'leads' AND c.conname = 'leads_pkey'
  ) THEN
    ALTER TABLE ONLY public.leads
        ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'mensagens_processadas' AND c.conname = 'mensagens_processadas_pkey'
  ) THEN
    ALTER TABLE ONLY public.mensagens_processadas
        ADD CONSTRAINT mensagens_processadas_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notificacoes' AND c.conname = 'notificacoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.notificacoes
        ADD CONSTRAINT notificacoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_pkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'organizacoes' AND c.conname = 'organizacoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.organizacoes
        ADD CONSTRAINT organizacoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'organizacoes' AND c.conname = 'organizacoes_slug_key'
  ) THEN
    ALTER TABLE ONLY public.organizacoes
        ADD CONSTRAINT organizacoes_slug_key UNIQUE (slug);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfil_permissoes' AND c.conname = 'perfil_permissoes_perfil_id_permissao_key'
  ) THEN
    ALTER TABLE ONLY public.perfil_permissoes
        ADD CONSTRAINT perfil_permissoes_perfil_id_permissao_key UNIQUE (perfil_id, permissao);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfil_permissoes' AND c.conname = 'perfil_permissoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.perfil_permissoes
        ADD CONSTRAINT perfil_permissoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfis' AND c.conname = 'perfis_pkey'
  ) THEN
    ALTER TABLE ONLY public.perfis
        ADD CONSTRAINT perfis_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipeline_estagios' AND c.conname = 'pipeline_estagios_pipeline_id_chave_key'
  ) THEN
    ALTER TABLE ONLY public.pipeline_estagios
        ADD CONSTRAINT pipeline_estagios_pipeline_id_chave_key UNIQUE (pipeline_id, chave);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipeline_estagios' AND c.conname = 'pipeline_estagios_pkey'
  ) THEN
    ALTER TABLE ONLY public.pipeline_estagios
        ADD CONSTRAINT pipeline_estagios_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipelines' AND c.conname = 'pipelines_pkey'
  ) THEN
    ALTER TABLE ONLY public.pipelines
        ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas_comerciais' AND c.conname = 'propostas_comerciais_pkey'
  ) THEN
    ALTER TABLE ONLY public.propostas_comerciais
        ADD CONSTRAINT propostas_comerciais_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas' AND c.conname = 'propostas_pkey'
  ) THEN
    ALTER TABLE ONLY public.propostas
        ADD CONSTRAINT propostas_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'servicos_recorrentes' AND c.conname = 'servicos_recorrentes_pkey'
  ) THEN
    ALTER TABLE ONLY public.servicos_recorrentes
        ADD CONSTRAINT servicos_recorrentes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_pkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'templates' AND c.conname = 'templates_pkey'
  ) THEN
    ALTER TABLE ONLY public.templates
        ADD CONSTRAINT templates_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'usuarios' AND c.conname = 'usuarios_email_key'
  ) THEN
    ALTER TABLE ONLY public.usuarios
        ADD CONSTRAINT usuarios_email_key UNIQUE (email);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'usuarios' AND c.conname = 'usuarios_pkey'
  ) THEN
    ALTER TABLE ONLY public.usuarios
        ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'whatsapp_mensagens' AND c.conname = 'whatsapp_mensagens_pkey'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_mensagens
        ADD CONSTRAINT whatsapp_mensagens_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucao_eventos' AND c.conname = 'workflow_execucao_eventos_pkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucao_eventos
        ADD CONSTRAINT workflow_execucao_eventos_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_versoes' AND c.conname = 'workflow_versoes_pkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_versoes
        ADD CONSTRAINT workflow_versoes_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_versoes' AND c.conname = 'workflow_versoes_workflow_id_numero_key'
  ) THEN
    ALTER TABLE ONLY public.workflow_versoes
        ADD CONSTRAINT workflow_versoes_workflow_id_numero_key UNIQUE (workflow_id, numero);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflows' AND c.conname = 'workflows_pkey'
  ) THEN
    ALTER TABLE ONLY public.workflows
        ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);
  END IF;
END $mig0000$;

--
-- Name: idx_campanhas_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_campanhas_organizacao ON public.campanhas USING btree (organizacao_id);

--
-- Name: idx_campanhas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_campanhas_status ON public.campanhas USING btree (organizacao_id, status);

--
-- Name: idx_comercial_grupo_comandos_handoff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_comercial_grupo_comandos_handoff ON public.comercial_grupo_comandos USING btree (organizacao_id, handoff_id);

--
-- Name: idx_comercial_grupo_comandos_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_comercial_grupo_comandos_pendentes ON public.comercial_grupo_comandos USING btree (organizacao_id, status) WHERE (status = ANY (ARRAY['recebido'::text, 'processando'::text, 'falhou'::text]));

--
-- Name: idx_comercial_handoff_notificacoes_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_comercial_handoff_notificacoes_pendentes ON public.comercial_handoff_notificacoes USING btree (organizacao_id, status) WHERE (status <> 'enviada'::text);

--
-- Name: idx_comercial_handoffs_lead_historico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_comercial_handoffs_lead_historico ON public.comercial_handoffs USING btree (organizacao_id, lead_id, criado_em DESC);

--
-- Name: idx_comercial_handoffs_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_comercial_handoffs_responsavel ON public.comercial_handoffs USING btree (organizacao_id, responsavel_id) WHERE (encerrado_em IS NULL);

--
-- Name: idx_contatos_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contatos_email ON public.contatos USING btree (organizacao_id, email);

--
-- Name: idx_contatos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contatos_empresa ON public.contatos USING btree (empresa_id);

--
-- Name: idx_contatos_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contatos_organizacao ON public.contatos USING btree (organizacao_id);

--
-- Name: idx_empresas_dominio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_empresas_dominio ON public.empresas USING btree (organizacao_id, dominio);

--
-- Name: idx_empresas_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_empresas_organizacao ON public.empresas USING btree (organizacao_id);

--
-- Name: idx_empresas_revisao_pendente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_empresas_revisao_pendente ON public.empresas USING btree (organizacao_id) WHERE revisao_pendente;

--
-- Name: idx_interacoes_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_interacoes_organizacao ON public.interacoes USING btree (organizacao_id);

--
-- Name: idx_interacoes_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_interacoes_template ON public.interacoes USING btree (template_id) WHERE (template_id IS NOT NULL);

--
-- Name: idx_laudo_ciclos_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_laudo_ciclos_lead ON public.laudo_ciclos USING btree (lead_id, criado_em);

--
-- Name: idx_laudo_ciclos_org_validade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_laudo_ciclos_org_validade ON public.laudo_ciclos USING btree (organizacao_id, validade_em);

--
-- Name: idx_leads_bounced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_bounced ON public.leads USING btree (organizacao_id) WHERE (bounced = true);

--
-- Name: idx_leads_contato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_contato ON public.leads USING btree (contato_id);

--
-- Name: idx_leads_data_validade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_data_validade ON public.leads USING btree (data_validade) WHERE (data_validade IS NOT NULL);

--
-- Name: idx_leads_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_empresa ON public.leads USING btree (empresa_id);

--
-- Name: idx_leads_estagio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_estagio ON public.leads USING btree (estagio);

--
-- Name: idx_leads_estagio_followups; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_estagio_followups ON public.leads USING btree (estagio, followups_enviados);

--
-- Name: idx_leads_optout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_optout ON public.leads USING btree (organizacao_id) WHERE (optout = true);

--
-- Name: idx_leads_org_responsavel_carteira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_org_responsavel_carteira ON public.leads USING btree (organizacao_id, responsavel_id, id);

--
-- Name: idx_leads_org_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_org_score ON public.leads USING btree (organizacao_id, score DESC);

--
-- Name: idx_leads_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_organizacao ON public.leads USING btree (organizacao_id);

--
-- Name: idx_leads_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_leads_owner ON public.leads USING btree (owner);

--
-- Name: idx_mensagens_processadas_processado_em; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_mensagens_processadas_processado_em ON public.mensagens_processadas USING btree (processado_em);

--
-- Name: idx_notificacoes_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notificacoes_criado ON public.notificacoes USING btree (organizacao_id, criado_em);

--
-- Name: idx_notificacoes_destinatario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notificacoes_destinatario ON public.notificacoes USING btree (organizacao_id, perfil_id, lida);

--
-- Name: idx_oportunidades_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_empresa ON public.oportunidades USING btree (empresa_id);

--
-- Name: idx_oportunidades_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_lead ON public.oportunidades USING btree (lead_id);

--
-- Name: idx_oportunidades_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_organizacao ON public.oportunidades USING btree (organizacao_id);

--
-- Name: idx_oportunidades_previsao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_previsao ON public.oportunidades USING btree (organizacao_id, previsao_fechamento) WHERE (status = 'aberta'::text);

--
-- Name: idx_oportunidades_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_status ON public.oportunidades USING btree (organizacao_id, status);

--
-- Name: idx_perfil_permissoes_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_perfil_permissoes_organizacao ON public.perfil_permissoes USING btree (organizacao_id);

--
-- Name: idx_perfil_permissoes_perfil; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_perfil_permissoes_perfil ON public.perfil_permissoes USING btree (perfil_id);

--
-- Name: idx_perfis_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_perfis_organizacao ON public.perfis USING btree (organizacao_id);

--
-- Name: idx_pipeline_estagios_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pipeline_estagios_organizacao ON public.pipeline_estagios USING btree (organizacao_id);

--
-- Name: idx_pipeline_estagios_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pipeline_estagios_pipeline ON public.pipeline_estagios USING btree (pipeline_id);

--
-- Name: idx_pipelines_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pipelines_organizacao ON public.pipelines USING btree (organizacao_id);

--
-- Name: idx_propostas_comerciais_org_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_org_criado ON public.propostas_comerciais USING btree (organizacao_id, criado_em DESC, id DESC);

--
-- Name: idx_propostas_comerciais_org_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_org_lead ON public.propostas_comerciais USING btree (organizacao_id, lead_id, criado_em DESC, id DESC);

--
-- Name: idx_propostas_criado_por; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_propostas_criado_por ON public.propostas USING btree (organizacao_id, criado_por);

--
-- Name: idx_propostas_organizacao_criado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_propostas_organizacao_criado ON public.propostas USING btree (organizacao_id, criado_em DESC);

--
-- Name: idx_servicos_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_servicos_empresa ON public.servicos_recorrentes USING btree (empresa_id);

--
-- Name: idx_servicos_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_servicos_organizacao ON public.servicos_recorrentes USING btree (organizacao_id);

--
-- Name: idx_servicos_vencimento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_servicos_vencimento ON public.servicos_recorrentes USING btree (organizacao_id, vencimento_em) WHERE (arquivado = false);

--
-- Name: idx_tarefas_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tarefas_lead ON public.tarefas USING btree (lead_id);

--
-- Name: idx_tarefas_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tarefas_organizacao ON public.tarefas USING btree (organizacao_id);

--
-- Name: idx_tarefas_prazo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tarefas_prazo ON public.tarefas USING btree (organizacao_id, prazo_em) WHERE (status <> 'concluida'::text);

--
-- Name: idx_tarefas_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tarefas_responsavel ON public.tarefas USING btree (organizacao_id, responsavel_id);

--
-- Name: idx_tarefas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tarefas_status ON public.tarefas USING btree (organizacao_id, status);

--
-- Name: idx_templates_org_canal_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_templates_org_canal_tipo ON public.templates USING btree (organizacao_id, canal, tipo);

--
-- Name: idx_templates_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_templates_organizacao ON public.templates USING btree (organizacao_id);

--
-- Name: idx_usuarios_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_organizacao ON public.usuarios USING btree (organizacao_id);

--
-- Name: idx_whatsapp_mensagens_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_created_at ON public.whatsapp_mensagens USING btree (created_at);

--
-- Name: idx_whatsapp_mensagens_lead_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_lead_id ON public.whatsapp_mensagens USING btree (lead_id) WHERE (lead_id IS NOT NULL);

--
-- Name: idx_whatsapp_mensagens_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_org ON public.whatsapp_mensagens USING btree (organizacao_id) WHERE (organizacao_id IS NOT NULL);

--
-- Name: idx_whatsapp_mensagens_remetente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_remetente ON public.whatsapp_mensagens USING btree (remetente);

--
-- Name: idx_workflow_eventos_execucao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_eventos_execucao ON public.workflow_execucao_eventos USING btree (execucao_id);

--
-- Name: idx_workflow_execucoes_campanha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_campanha ON public.workflow_execucoes USING btree (campanha_id) WHERE (campanha_id IS NOT NULL);

--
-- Name: idx_workflow_execucoes_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_organizacao ON public.workflow_execucoes USING btree (organizacao_id);

--
-- Name: idx_workflow_execucoes_poll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_poll ON public.workflow_execucoes USING btree (proxima_verificacao_em) WHERE (status = 'aguardando'::text);

--
-- Name: idx_workflow_execucoes_servico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_servico ON public.workflow_execucoes USING btree (organizacao_id, servico_id) WHERE (servico_id IS NOT NULL);

--
-- Name: idx_workflow_execucoes_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_execucoes_workflow ON public.workflow_execucoes USING btree (workflow_id);

--
-- Name: idx_workflow_prospeccao_reconciliacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_prospeccao_reconciliacao ON public.workflow_execucoes USING btree (organizacao_id, id) WHERE (status = 'aguardando'::text);

--
-- Name: idx_workflow_versoes_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflow_versoes_workflow ON public.workflow_versoes USING btree (workflow_id);

--
-- Name: idx_workflows_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_workflows_organizacao ON public.workflows USING btree (organizacao_id);

--
-- Name: uniq_comercial_grupo_comandos_mensagem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_comercial_grupo_comandos_mensagem ON public.comercial_grupo_comandos USING btree (organizacao_id, provider_message_id);

--
-- Name: uniq_comercial_handoff_notificacoes_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_comercial_handoff_notificacoes_codigo ON public.comercial_handoff_notificacoes USING btree (organizacao_id, codigo_ref) WHERE (codigo_ref IS NOT NULL);

--
-- Name: uniq_comercial_handoff_notificacoes_handoff_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_comercial_handoff_notificacoes_handoff_tipo ON public.comercial_handoff_notificacoes USING btree (handoff_id, tipo);

--
-- Name: uniq_comercial_handoffs_aberto_por_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_comercial_handoffs_aberto_por_lead ON public.comercial_handoffs USING btree (organizacao_id, lead_id) WHERE (encerrado_em IS NULL);

--
-- Name: uniq_comercial_handoffs_evento; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_comercial_handoffs_evento ON public.comercial_handoffs USING btree (organizacao_id, lead_id, evento_id);

--
-- Name: uniq_interacao_bounce_por_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interacao_bounce_por_lead ON public.interacoes USING btree (organizacao_id, lead_id) WHERE (descricao ~~ 'Bounce SMTP detectado%'::text);

--
-- Name: uniq_mensagens_processadas_org_mensagem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_mensagens_processadas_org_mensagem ON public.mensagens_processadas USING btree (organizacao_id, mensagem_id);

--
-- Name: uniq_organizacoes_grupo_comercial; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_organizacoes_grupo_comercial ON public.organizacoes USING btree ((((configuracoes -> 'comercial'::text) ->> 'grupoWhatsappId'::text))) WHERE (((configuracoes -> 'comercial'::text) ->> 'grupoWhatsappId'::text) IS NOT NULL);

--
-- Name: uniq_tarefa_renovacao_lead_legado; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tarefa_renovacao_lead_legado ON public.tarefas USING btree (organizacao_id, lead_id, prazo_em) WHERE ((tipo = 'renovacao'::text) AND (servico_id IS NULL) AND (lead_id IS NOT NULL));

--
-- Name: uniq_tarefa_renovacao_servico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tarefa_renovacao_servico ON public.tarefas USING btree (organizacao_id, servico_id, prazo_em) WHERE ((tipo = 'renovacao'::text) AND (servico_id IS NOT NULL));

--
-- Name: uniq_usuarios_id_organizacao; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_usuarios_id_organizacao ON public.usuarios USING btree (id, organizacao_id);

--
-- Name: uniq_whatsapp_mensagens_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_mensagens_message_id ON public.whatsapp_mensagens USING btree (whatsapp_message_id);

--
-- Name: uq_empresas_cnpj_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_cnpj_org ON public.empresas USING btree (organizacao_id, cnpj) WHERE ((cnpj IS NOT NULL) AND (cnpj <> ''::text));

--
-- Name: uq_laudo_ciclos_atual_por_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_laudo_ciclos_atual_por_lead ON public.laudo_ciclos USING btree (lead_id) WHERE (renovado_em IS NULL);

--
-- Name: uq_workflow_execucoes_ciclo_renovacao; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_execucoes_ciclo_renovacao ON public.workflow_execucoes USING btree (organizacao_id, workflow_id, lead_id, ciclo_chave) WHERE ((ciclo_chave IS NOT NULL) AND (lead_id IS NOT NULL));

--
-- Name: leads leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

--
-- Name: campanhas trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.campanhas FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: comercial_distribuicao_participantes trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.comercial_distribuicao_participantes FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: comercial_grupo_comandos trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.comercial_grupo_comandos FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: comercial_handoff_notificacoes trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.comercial_handoff_notificacoes FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: comercial_handoffs trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.comercial_handoffs FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: oportunidades trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: propostas trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.propostas FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: propostas_comerciais trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.propostas_comerciais FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: templates trg_atualizado_em; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_atualizado_em BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

--
-- Name: servicos_recorrentes trg_calc_vencimento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_calc_vencimento BEFORE INSERT OR UPDATE ON public.servicos_recorrentes FOR EACH ROW EXECUTE FUNCTION public.calc_vencimento_servico();

--
-- Name: templates trg_organizacao_imutavel; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_organizacao_imutavel BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.impedir_troca_organizacao_id();

--
-- Name: campanhas trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.campanhas FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: contatos trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.contatos FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: empresas trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.empresas FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: interacoes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.interacoes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: laudo_ciclos trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.laudo_ciclos FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: leads trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: notificacoes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.notificacoes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: oportunidades trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.oportunidades FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: perfil_permissoes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.perfil_permissoes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: perfis trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.perfis FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: pipeline_estagios trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.pipeline_estagios FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: pipelines trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: propostas trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.propostas FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: servicos_recorrentes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.servicos_recorrentes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: tarefas trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: templates trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: usuarios trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: workflow_execucao_eventos trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.workflow_execucao_eventos FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: workflow_execucoes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.workflow_execucoes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: workflow_versoes trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.workflow_versoes FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: workflows trg_set_org_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_set_org_id BEFORE INSERT ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.set_org_id_default();

--
-- Name: leads trg_sync_lead_entidades; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER trg_sync_lead_entidades AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sync_lead_para_entidades();

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'campanhas' AND c.conname = 'campanhas_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.campanhas
        ADD CONSTRAINT campanhas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'campanhas' AND c.conname = 'campanhas_workflow_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.campanhas
        ADD CONSTRAINT campanhas_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_cursor' AND c.conname = 'comercial_distribuicao_cursor_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_cursor
        ADD CONSTRAINT comercial_distribuicao_cursor_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_cursor' AND c.conname = 'comercial_distribuicao_cursor_ultimo_usuario_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_cursor
        ADD CONSTRAINT comercial_distribuicao_cursor_ultimo_usuario_id_fkey FOREIGN KEY (ultimo_usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_participantes' AND c.conname = 'comercial_distribuicao_participa_usuario_id_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_participantes
        ADD CONSTRAINT comercial_distribuicao_participa_usuario_id_organizacao_id_fkey FOREIGN KEY (usuario_id, organizacao_id) REFERENCES public.usuarios(id, organizacao_id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_distribuicao_participantes' AND c.conname = 'comercial_distribuicao_participantes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_distribuicao_participantes
        ADD CONSTRAINT comercial_distribuicao_participantes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_grupo_comandos' AND c.conname = 'comercial_grupo_comandos_handoff_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_grupo_comandos
        ADD CONSTRAINT comercial_grupo_comandos_handoff_id_fkey FOREIGN KEY (handoff_id) REFERENCES public.comercial_handoffs(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_grupo_comandos' AND c.conname = 'comercial_grupo_comandos_notificacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_grupo_comandos
        ADD CONSTRAINT comercial_grupo_comandos_notificacao_id_fkey FOREIGN KEY (notificacao_id) REFERENCES public.comercial_handoff_notificacoes(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_grupo_comandos' AND c.conname = 'comercial_grupo_comandos_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_grupo_comandos
        ADD CONSTRAINT comercial_grupo_comandos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoff_notificacoes' AND c.conname = 'comercial_handoff_notificacoes_handoff_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoff_notificacoes
        ADD CONSTRAINT comercial_handoff_notificacoes_handoff_id_fkey FOREIGN KEY (handoff_id) REFERENCES public.comercial_handoffs(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoff_notificacoes' AND c.conname = 'comercial_handoff_notificacoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoff_notificacoes
        ADD CONSTRAINT comercial_handoff_notificacoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoffs' AND c.conname = 'comercial_handoffs_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoffs
        ADD CONSTRAINT comercial_handoffs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoffs' AND c.conname = 'comercial_handoffs_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoffs
        ADD CONSTRAINT comercial_handoffs_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'comercial_handoffs' AND c.conname = 'comercial_handoffs_responsavel_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.comercial_handoffs
        ADD CONSTRAINT comercial_handoffs_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'configuracoes_motor' AND c.conname = 'configuracoes_motor_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.configuracoes_motor
        ADD CONSTRAINT configuracoes_motor_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'contatos' AND c.conname = 'contatos_empresa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.contatos
        ADD CONSTRAINT contatos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'contatos' AND c.conname = 'contatos_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.contatos
        ADD CONSTRAINT contatos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'empresas' AND c.conname = 'empresas_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.empresas
        ADD CONSTRAINT empresas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'interacoes' AND c.conname = 'interacoes_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.interacoes
        ADD CONSTRAINT interacoes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'interacoes' AND c.conname = 'interacoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.interacoes
        ADD CONSTRAINT interacoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'interacoes' AND c.conname = 'interacoes_responsavel_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.interacoes
        ADD CONSTRAINT interacoes_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'interacoes' AND c.conname = 'interacoes_template_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.interacoes
        ADD CONSTRAINT interacoes_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'laudo_ciclos' AND c.conname = 'laudo_ciclos_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.laudo_ciclos
        ADD CONSTRAINT laudo_ciclos_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'laudo_ciclos' AND c.conname = 'laudo_ciclos_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.laudo_ciclos
        ADD CONSTRAINT laudo_ciclos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'leads' AND c.conname = 'leads_contato_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.leads
        ADD CONSTRAINT leads_contato_id_fkey FOREIGN KEY (contato_id) REFERENCES public.contatos(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'leads' AND c.conname = 'leads_empresa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.leads
        ADD CONSTRAINT leads_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'leads' AND c.conname = 'leads_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.leads
        ADD CONSTRAINT leads_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'leads' AND c.conname = 'leads_responsavel_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.leads
        ADD CONSTRAINT leads_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'mensagens_processadas' AND c.conname = 'mensagens_processadas_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.mensagens_processadas
        ADD CONSTRAINT mensagens_processadas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'mensagens_processadas' AND c.conname = 'mensagens_processadas_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.mensagens_processadas
        ADD CONSTRAINT mensagens_processadas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notificacoes' AND c.conname = 'notificacoes_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.notificacoes
        ADD CONSTRAINT notificacoes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notificacoes' AND c.conname = 'notificacoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.notificacoes
        ADD CONSTRAINT notificacoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notificacoes' AND c.conname = 'notificacoes_perfil_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.notificacoes
        ADD CONSTRAINT notificacoes_perfil_id_fkey FOREIGN KEY (perfil_id) REFERENCES public.perfis(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'notificacoes' AND c.conname = 'notificacoes_tarefa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.notificacoes
        ADD CONSTRAINT notificacoes_tarefa_id_fkey FOREIGN KEY (tarefa_id) REFERENCES public.tarefas(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_contato_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_contato_id_fkey FOREIGN KEY (contato_id) REFERENCES public.contatos(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_empresa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_estagio_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_estagio_id_fkey FOREIGN KEY (estagio_id) REFERENCES public.pipeline_estagios(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_pipeline_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'oportunidades' AND c.conname = 'oportunidades_servico_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.oportunidades
        ADD CONSTRAINT oportunidades_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servicos_recorrentes(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfil_permissoes' AND c.conname = 'perfil_permissoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.perfil_permissoes
        ADD CONSTRAINT perfil_permissoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfil_permissoes' AND c.conname = 'perfil_permissoes_perfil_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.perfil_permissoes
        ADD CONSTRAINT perfil_permissoes_perfil_id_fkey FOREIGN KEY (perfil_id) REFERENCES public.perfis(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfis' AND c.conname = 'perfis_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.perfis
        ADD CONSTRAINT perfis_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'perfis' AND c.conname = 'perfis_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.perfis
        ADD CONSTRAINT perfis_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipeline_estagios' AND c.conname = 'pipeline_estagios_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.pipeline_estagios
        ADD CONSTRAINT pipeline_estagios_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipeline_estagios' AND c.conname = 'pipeline_estagios_pipeline_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.pipeline_estagios
        ADD CONSTRAINT pipeline_estagios_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pipelines' AND c.conname = 'pipelines_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.pipelines
        ADD CONSTRAINT pipelines_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas_comerciais' AND c.conname = 'propostas_comerciais_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.propostas_comerciais
        ADD CONSTRAINT propostas_comerciais_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas_comerciais' AND c.conname = 'propostas_comerciais_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.propostas_comerciais
        ADD CONSTRAINT propostas_comerciais_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas' AND c.conname = 'propostas_criado_por_fkey'
  ) THEN
    ALTER TABLE ONLY public.propostas
        ADD CONSTRAINT propostas_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.perfis(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'propostas' AND c.conname = 'propostas_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.propostas
        ADD CONSTRAINT propostas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'servicos_recorrentes' AND c.conname = 'servicos_recorrentes_empresa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.servicos_recorrentes
        ADD CONSTRAINT servicos_recorrentes_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'servicos_recorrentes' AND c.conname = 'servicos_recorrentes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.servicos_recorrentes
        ADD CONSTRAINT servicos_recorrentes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_contato_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_contato_id_fkey FOREIGN KEY (contato_id) REFERENCES public.contatos(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_empresa_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'tarefas' AND c.conname = 'tarefas_servico_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.tarefas
        ADD CONSTRAINT tarefas_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servicos_recorrentes(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'templates' AND c.conname = 'templates_atualizado_por_fkey'
  ) THEN
    ALTER TABLE ONLY public.templates
        ADD CONSTRAINT templates_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES public.perfis(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'templates' AND c.conname = 'templates_criado_por_fkey'
  ) THEN
    ALTER TABLE ONLY public.templates
        ADD CONSTRAINT templates_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES public.perfis(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'templates' AND c.conname = 'templates_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.templates
        ADD CONSTRAINT templates_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'usuarios' AND c.conname = 'usuarios_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.usuarios
        ADD CONSTRAINT usuarios_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'whatsapp_mensagens' AND c.conname = 'whatsapp_mensagens_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_mensagens
        ADD CONSTRAINT whatsapp_mensagens_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'whatsapp_mensagens' AND c.conname = 'whatsapp_mensagens_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.whatsapp_mensagens
        ADD CONSTRAINT whatsapp_mensagens_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucao_eventos' AND c.conname = 'workflow_execucao_eventos_execucao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucao_eventos
        ADD CONSTRAINT workflow_execucao_eventos_execucao_id_fkey FOREIGN KEY (execucao_id) REFERENCES public.workflow_execucoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucao_eventos' AND c.conname = 'workflow_execucao_eventos_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucao_eventos
        ADD CONSTRAINT workflow_execucao_eventos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_campanha_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_campanha_id_fkey FOREIGN KEY (campanha_id) REFERENCES public.campanhas(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_lead_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_servico_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES public.servicos_recorrentes(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_versao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_versao_id_fkey FOREIGN KEY (versao_id) REFERENCES public.workflow_versoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_execucoes' AND c.conname = 'workflow_execucoes_workflow_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_execucoes
        ADD CONSTRAINT workflow_execucoes_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_versoes' AND c.conname = 'workflow_versoes_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_versoes
        ADD CONSTRAINT workflow_versoes_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_versoes' AND c.conname = 'workflow_versoes_publicado_por_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_versoes
        ADD CONSTRAINT workflow_versoes_publicado_por_fkey FOREIGN KEY (publicado_por) REFERENCES public.perfis(id) ON DELETE SET NULL;
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflow_versoes' AND c.conname = 'workflow_versoes_workflow_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflow_versoes
        ADD CONSTRAINT workflow_versoes_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflows' AND c.conname = 'workflows_organizacao_id_fkey'
  ) THEN
    ALTER TABLE ONLY public.workflows
        ADD CONSTRAINT workflows_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.organizacoes(id);
  END IF;
END $mig0000$;

DO $mig0000$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'workflows' AND c.conname = 'workflows_versao_atual_fk'
  ) THEN
    ALTER TABLE ONLY public.workflows
        ADD CONSTRAINT workflows_versao_atual_fk FOREIGN KEY (versao_atual_id) REFERENCES public.workflow_versoes(id);
  END IF;
END $mig0000$;

--
-- Name: campanhas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campanhas_tenant ON public.campanhas;
CREATE POLICY campanhas_tenant ON public.campanhas USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: comercial_distribuicao_cursor; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comercial_distribuicao_cursor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercial_distribuicao_cursor_leitura ON public.comercial_distribuicao_cursor;
CREATE POLICY comercial_distribuicao_cursor_leitura ON public.comercial_distribuicao_cursor FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: comercial_distribuicao_participantes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comercial_distribuicao_participantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercial_distribuicao_participantes_leitura ON public.comercial_distribuicao_participantes;
CREATE POLICY comercial_distribuicao_participantes_leitura ON public.comercial_distribuicao_participantes FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: comercial_grupo_comandos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comercial_grupo_comandos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercial_grupo_comandos_leitura ON public.comercial_grupo_comandos;
CREATE POLICY comercial_grupo_comandos_leitura ON public.comercial_grupo_comandos FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: comercial_handoff_notificacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comercial_handoff_notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercial_handoff_notificacoes_leitura ON public.comercial_handoff_notificacoes;
CREATE POLICY comercial_handoff_notificacoes_leitura ON public.comercial_handoff_notificacoes FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: comercial_handoffs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comercial_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercial_handoffs_leitura ON public.comercial_handoffs;
CREATE POLICY comercial_handoffs_leitura ON public.comercial_handoffs FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: configuracoes_motor; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.configuracoes_motor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS configuracoes_motor_tenant ON public.configuracoes_motor;
CREATE POLICY configuracoes_motor_tenant ON public.configuracoes_motor USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: contatos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contatos_tenant ON public.contatos;
CREATE POLICY contatos_tenant ON public.contatos USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: empresas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empresas_tenant ON public.empresas;
CREATE POLICY empresas_tenant ON public.empresas USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: interacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interacoes_carteira ON public.interacoes;
CREATE POLICY interacoes_carteira ON public.interacoes USING (((organizacao_id = public.current_org_id()) AND ((public.current_profile_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE ((l.id = interacoes.lead_id) AND (l.organizacao_id = interacoes.organizacao_id))))))) WITH CHECK (((organizacao_id = public.current_org_id()) AND ((public.current_profile_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE ((l.id = interacoes.lead_id) AND (l.organizacao_id = interacoes.organizacao_id)))))));

--
-- Name: laudo_ciclos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.laudo_ciclos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS laudo_ciclos_leitura ON public.laudo_ciclos;
CREATE POLICY laudo_ciclos_leitura ON public.laudo_ciclos FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_carteira ON public.leads;
CREATE POLICY leads_carteira ON public.leads USING (((organizacao_id = public.current_org_id()) AND ((public.current_profile_role() = 'admin'::text) OR (responsavel_id = public.current_commercial_user_id()) OR ((responsavel_id IS NULL) AND (public.current_commercial_user_name() IS NOT NULL) AND (responsavel_nome ~~* (public.current_commercial_user_name() || '%'::text)))))) WITH CHECK (((organizacao_id = public.current_org_id()) AND ((public.current_profile_role() = 'admin'::text) OR (responsavel_id = public.current_commercial_user_id()))));

--
-- Name: mensagens_processadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mensagens_processadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mensagens_processadas_leitura ON public.mensagens_processadas;
CREATE POLICY mensagens_processadas_leitura ON public.mensagens_processadas FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: notificacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificacoes_tenant ON public.notificacoes;
CREATE POLICY notificacoes_tenant ON public.notificacoes USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: oportunidades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oportunidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oportunidades_tenant ON public.oportunidades;
CREATE POLICY oportunidades_tenant ON public.oportunidades USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: organizacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizacoes_tenant ON public.organizacoes;
CREATE POLICY organizacoes_tenant ON public.organizacoes USING ((id = public.current_org_id())) WITH CHECK ((id = public.current_org_id()));

--
-- Name: perfil_permissoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.perfil_permissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfil_permissoes_tenant ON public.perfil_permissoes;
CREATE POLICY perfil_permissoes_tenant ON public.perfil_permissoes USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: perfis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfis_tenant ON public.perfis;
CREATE POLICY perfis_tenant ON public.perfis USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: pipeline_estagios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_estagios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_estagios_tenant ON public.pipeline_estagios;
CREATE POLICY pipeline_estagios_tenant ON public.pipeline_estagios USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipelines_tenant ON public.pipelines;
CREATE POLICY pipelines_tenant ON public.pipelines USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: propostas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.propostas ENABLE ROW LEVEL SECURITY;

--
-- Name: propostas_comerciais; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.propostas_comerciais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propostas_comerciais_leitura ON public.propostas_comerciais;
CREATE POLICY propostas_comerciais_leitura ON public.propostas_comerciais FOR SELECT USING (((organizacao_id = public.current_org_id()) AND ((public.current_profile_role() = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.leads l
  WHERE ((l.id = propostas_comerciais.lead_id) AND (l.organizacao_id = propostas_comerciais.organizacao_id)))))));

DROP POLICY IF EXISTS propostas_tenant ON public.propostas;
CREATE POLICY propostas_tenant ON public.propostas USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: servicos_recorrentes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.servicos_recorrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servicos_recorrentes_tenant ON public.servicos_recorrentes;
CREATE POLICY servicos_recorrentes_tenant ON public.servicos_recorrentes USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: tarefas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tarefas_tenant ON public.tarefas;
CREATE POLICY tarefas_tenant ON public.tarefas USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS templates_tenant ON public.templates;
CREATE POLICY templates_tenant ON public.templates USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: usuarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_tenant ON public.usuarios;
CREATE POLICY usuarios_tenant ON public.usuarios USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: whatsapp_mensagens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_mensagens_leitura ON public.whatsapp_mensagens;
CREATE POLICY whatsapp_mensagens_leitura ON public.whatsapp_mensagens FOR SELECT USING ((organizacao_id = public.current_org_id()));

--
-- Name: workflow_execucao_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_execucao_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_execucao_eventos_tenant ON public.workflow_execucao_eventos;
CREATE POLICY workflow_execucao_eventos_tenant ON public.workflow_execucao_eventos USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: workflow_execucoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_execucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_execucoes_tenant ON public.workflow_execucoes;
CREATE POLICY workflow_execucoes_tenant ON public.workflow_execucoes USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: workflow_versoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflow_versoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_versoes_tenant ON public.workflow_versoes;
CREATE POLICY workflow_versoes_tenant ON public.workflow_versoes USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));

--
-- Name: workflows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflows_tenant ON public.workflows;
CREATE POLICY workflows_tenant ON public.workflows USING ((organizacao_id = public.current_org_id())) WITH CHECK ((organizacao_id = public.current_org_id()));
