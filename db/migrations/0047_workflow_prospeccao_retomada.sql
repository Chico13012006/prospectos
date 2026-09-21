-- Despertar durável exclusivo das campanhas de prospecção.
-- Estado e exclusão mútua vivem na execução; a fila é somente um despertador.
alter table workflow_execucoes
  add column if not exists agendamento_geracao integer not null default 0,
  add column if not exists agendamento_publicado_em timestamptz,
  add column if not exists agendamento_checkpoint_em timestamptz,
  add column if not exists publicacao_token uuid,
  add column if not exists publicacao_expira_em timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists claim_expira_em timestamptz;

create index if not exists idx_workflow_prospeccao_reconciliacao
  on workflow_execucoes (organizacao_id, id)
  where status = 'aguardando';

-- Toda função que devolve execução usa `setof`: "não casou" precisa ser ZERO
-- linha. Retorno composto NULO chega no PostgREST como objeto de campos nulos
-- e seria lido como sucesso pelo executor.
drop function if exists workflow_prospeccao_agendar_espera(uuid, uuid, integer, integer, timestamptz, uuid);
create function workflow_prospeccao_agendar_espera(
  p_org uuid, p_id uuid, p_passo_esperado integer, p_proximo_passo integer,
  p_ate timestamptz, p_claim_token uuid default null
) returns setof workflow_execucoes
language sql security definer set search_path = public as $$
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

drop function if exists workflow_prospeccao_claim(uuid, uuid, integer, integer, uuid);
create function workflow_prospeccao_claim(
  p_org uuid, p_id uuid, p_geracao integer, p_passo integer, p_token uuid
) returns setof workflow_execucoes
language sql security definer set search_path = public as $$
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

create or replace function workflow_prospeccao_liberar_claim(
  p_org uuid, p_id uuid, p_token uuid
) returns void
language sql security definer set search_path = public as $$
  update workflow_execucoes set claim_token = null, claim_expira_em = null
  where organizacao_id = p_org and id = p_id and claim_token = p_token;
$$;

-- Uma única publicação em voo por geração. A falha entre persistir e publicar
-- deixa a intenção sem confirmação para o watchdog; a expiração libera retry.
create or replace function workflow_prospeccao_claim_publicacao(
  p_org uuid, p_id uuid, p_geracao integer, p_token uuid,
  p_checkpoint timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
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

create or replace function workflow_prospeccao_confirmar_publicacao(
  p_org uuid, p_id uuid, p_geracao integer, p_token uuid
) returns void
language sql security definer set search_path = public as $$
  update workflow_execucoes set agendamento_publicado_em = now(),
    publicacao_token = null, publicacao_expira_em = null
  where organizacao_id = p_org and id = p_id
    and agendamento_geracao = p_geracao and publicacao_token = p_token;
$$;

create or replace function workflow_prospeccao_liberar_publicacao(
  p_org uuid, p_id uuid, p_geracao integer, p_token uuid
) returns void
language sql security definer set search_path = public as $$
  update workflow_execucoes set publicacao_token = null,
    publicacao_expira_em = null, agendamento_checkpoint_em = null
  where organizacao_id = p_org and id = p_id
    and agendamento_geracao = p_geracao and publicacao_token = p_token;
$$;

-- Checkpoint de espera longa ou reparo de job perdido. O incremento invalida
-- jobs antigos antes de uma nova publicação. Claim ativo impede roubo do passo.
drop function if exists workflow_prospeccao_rearmar(uuid, uuid, integer);
create function workflow_prospeccao_rearmar(
  p_org uuid, p_id uuid, p_geracao integer
) returns setof workflow_execucoes
language sql security definer set search_path = public as $$
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

create or replace function workflow_prospeccao_reconciliar_lote(
  p_org uuid, p_depois uuid default null, p_limite integer default 100
) returns setof workflow_execucoes
language sql stable security definer set search_path = public as $$
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

revoke all on function workflow_prospeccao_agendar_espera(uuid, uuid, integer, integer, timestamptz, uuid) from public;
revoke all on function workflow_prospeccao_claim(uuid, uuid, integer, integer, uuid) from public;
revoke all on function workflow_prospeccao_liberar_claim(uuid, uuid, uuid) from public;
revoke all on function workflow_prospeccao_claim_publicacao(uuid, uuid, integer, uuid, timestamptz) from public;
revoke all on function workflow_prospeccao_confirmar_publicacao(uuid, uuid, integer, uuid) from public;
revoke all on function workflow_prospeccao_liberar_publicacao(uuid, uuid, integer, uuid) from public;
revoke all on function workflow_prospeccao_rearmar(uuid, uuid, integer) from public;
revoke all on function workflow_prospeccao_reconciliar_lote(uuid, uuid, integer) from public;
grant execute on function workflow_prospeccao_agendar_espera(uuid, uuid, integer, integer, timestamptz, uuid) to service_role;
grant execute on function workflow_prospeccao_claim(uuid, uuid, integer, integer, uuid) to service_role;
grant execute on function workflow_prospeccao_liberar_claim(uuid, uuid, uuid) to service_role;
grant execute on function workflow_prospeccao_claim_publicacao(uuid, uuid, integer, uuid, timestamptz) to service_role;
grant execute on function workflow_prospeccao_confirmar_publicacao(uuid, uuid, integer, uuid) to service_role;
grant execute on function workflow_prospeccao_liberar_publicacao(uuid, uuid, integer, uuid) to service_role;
grant execute on function workflow_prospeccao_rearmar(uuid, uuid, integer) to service_role;
grant execute on function workflow_prospeccao_reconciliar_lote(uuid, uuid, integer) to service_role;
