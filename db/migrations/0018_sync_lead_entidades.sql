-- ============================================================================
-- Migration 0018 — Fase 2d: write-sync transacional leads -> empresas/contatos
-- ----------------------------------------------------------------------------
-- Sincronização UNIDIRECIONAL (leads -> entidades) por TRIGGER no `leads`.
-- Por que trigger (e não código nas rotas):
--   - Roda na MESMA transação do UPDATE do lead => rollback INTEGRAL automático
--     se qualquer atualização falhar.
--   - NENHUMA escrita a contorna: rotas, serviços (lib/api), motor
--     (supabaseStore), workflows (ambiente), imports, scripts e até psql — todos
--     passam pelo trigger. É o único ponto que cobre 100% dos caminhos de escrita
--     (o inventário confirmou que todos batem no Postgres).
--
-- Escopo (transição): só PROPAGA mudanças dos CAMPOS CORE de empresa/contato.
-- Colunas de pipeline/motor (estagio, score, proxima_acao, responsavel,
-- followups, owner, perdido, optout...) NÃO disparam nada — o motor/workflows
-- seguem intactos (sem efeito colateral em pipeline/histórico).
--
-- Regras:
--   - Campos do CONTATO -> atualiza o contato LIGADO (leads.contato_id).
--   - Campos COMPARTILHADOS da empresa -> atualiza a empresa (leads.empresa_id)
--     E propaga aos DEMAIS leads da mesma empresa_id (consistência: sem versões
--     diferentes da mesma empresa).
--   - Anti-loop: pg_trigger_depth()>1 sai cedo (a propagação a leads irmãos
--     re-dispara o trigger, mas em profundidade 2 ele não faz nada).
--   - Anti-deadlock/concorrência: advisory lock por empresa (serializa o sync
--     de uma mesma empresa entre transações concorrentes).
--   - Auditoria da origem: sync_origem_lead_id + sync_em nas entidades.
--   - Só age quando o valor REALMENTE muda (is distinct from) => idempotente,
--     converge, sem escrita à toa.
-- Idempotente (create or replace / drop trigger if exists / add column if not exists).
-- ============================================================================

-- Auditoria da origem do sync nas entidades.
alter table empresas add column if not exists sync_origem_lead_id uuid;
alter table empresas add column if not exists sync_em timestamptz;
alter table contatos add column if not exists sync_origem_lead_id uuid;
alter table contatos add column if not exists sync_em timestamptz;

create or replace function sync_lead_para_entidades()
returns trigger
language plpgsql
as $$
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

drop trigger if exists trg_sync_lead_entidades on leads;
create trigger trg_sync_lead_entidades
  after update on leads
  for each row
  execute function sync_lead_para_entidades();

-- ----------------------------------------------------------------------------
-- CONFERÊNCIA:
--   select tgname, tgenabled from pg_trigger where tgrelid='leads'::regclass and not tgisinternal;
-- ----------------------------------------------------------------------------
