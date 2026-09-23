-- ============================================================================
-- Migration 0051 — Tela de prospecção: busca no catálogo, descartes e importação
-- ----------------------------------------------------------------------------
-- 1. prospeccao_descartes: CNPJs que a organização descartou na busca, para
--    não voltarem a aparecer. Isolada por organizacao_id, RLS de leitura por
--    org; escrita só pelo service_role (rota com resolverAcesso()).
-- 2. prospeccao_buscar / prospeccao_contar: busca paginada (keyset por cnpj)
--    no catálogo global (0050), marcando o que já está na base DA ORG e
--    ocultando o que a org descartou.
-- 3. prospeccao_importar: cria empresa + lead + contato por CNPJ numa única
--    transação, idempotente por (organizacao_id, cnpj).
--
-- Todas as funções são SECURITY DEFINER e recebem p_org do SERVIDOR (sessão),
-- nunca do cliente: EXECUTE fica só com service_role (mesmo padrão da 0048).
--
-- O lead importado nasce com owner='n8n' e estagio='novos_leads', igual à
-- importação por CSV: fica FORA do motor até ser inscrito deliberadamente numa
-- campanha. Importar não envia nada.
--
-- IDEMPOTENTE: if not exists / create or replace / drop policy if exists.
--
-- ROLLBACK:
--   drop function if exists prospeccao_importar(uuid, uuid, text, text, jsonb, boolean);
--   drop function if exists prospeccao_contar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text);
--   drop function if exists prospeccao_buscar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, text, integer);
--   drop table if exists prospeccao_descartes;
--   drop index if exists idx_leads_org_email_lower;
--   (empresas/contatos/leads criados ficam: são dados da org, com origem='catalogo_rf')
-- ============================================================================

-- "Já está na base" também compara e-mail do lead; sem este índice cada linha
-- da busca varreria os leads da organização.
create index if not exists idx_leads_org_email_lower
  on leads (organizacao_id, lower(contato_email));

create table if not exists prospeccao_descartes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  motivo text,
  descartado_por uuid,
  criado_em timestamptz not null default now(),
  unique (organizacao_id, cnpj)
);

alter table prospeccao_descartes enable row level security;
drop policy if exists prospeccao_descartes_leitura on prospeccao_descartes;
create policy prospeccao_descartes_leitura on prospeccao_descartes
  for select
  using (organizacao_id = current_org_id());

-- ----------------------------------------------------------------------------
-- Filtro comum da busca e da contagem.
-- ----------------------------------------------------------------------------
create or replace function prospeccao_filtro_ok(
  c catalogo_estabelecimentos,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text
) returns boolean
language sql immutable as $$
  select
    (c.cnae_principal = any(p_cnaes) or (p_secundarios and c.cnaes_secundarios && p_cnaes))
    and (coalesce(cardinality(p_ufs), 0) = 0 or c.uf = any(p_ufs))
    and (coalesce(cardinality(p_municipios), 0) = 0 or c.municipio_codigo = any(p_municipios))
    and (coalesce(cardinality(p_portes), 0) = 0 or c.porte = any(p_portes))
    and (not p_excluir_mei or c.mei is not true)
    and (not p_so_com_email or c.email is not null)
    and (
      coalesce(p_texto, '') = ''
      or c.razao_social ilike '%' || p_texto || '%'
      or c.nome_fantasia ilike '%' || p_texto || '%'
      or c.cnpj = regexp_replace(p_texto, '\D', '', 'g')
    )
$$;

drop function if exists prospeccao_buscar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, text, integer);
create function prospeccao_buscar(
  p_org uuid,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text,
  p_apos_cnpj text, p_limite integer
) returns table (
  cnpj text, razao_social text, nome_fantasia text, cnae_principal text,
  cnaes_secundarios text[], porte text, mei boolean, capital_social numeric,
  data_inicio_atividade date, logradouro text, numero text, bairro text, cep text,
  uf text, municipio text, telefone text, email text,
  ja_na_base boolean, lead_id uuid
)
language sql stable security definer set search_path = public as $$
  select
    c.cnpj, c.razao_social, c.nome_fantasia, c.cnae_principal,
    c.cnaes_secundarios, c.porte, c.mei, c.capital_social,
    c.data_inicio_atividade, c.logradouro, c.numero, c.bairro, c.cep,
    c.uf, c.municipio, c.telefone, c.email,
    (e.id is not null or l.id is not null) as ja_na_base,
    coalesce(le.id, l.id) as lead_id
  from catalogo_estabelecimentos c
  left join empresas e on e.organizacao_id = p_org and e.cnpj = c.cnpj
  left join lateral (
    select x.id from leads x
     where x.organizacao_id = p_org and e.id is not null and x.empresa_id = e.id
     order by x.id limit 1
  ) le on true
  left join lateral (
    select x.id from leads x
     where c.email is not null and x.organizacao_id = p_org
       and lower(x.contato_email) = c.email
     order by x.id limit 1
  ) l on true
  where prospeccao_filtro_ok(c, p_cnaes, p_secundarios, p_ufs, p_municipios,
                             p_portes, p_excluir_mei, p_so_com_email, p_texto)
    and not exists (
      select 1 from prospeccao_descartes d
       where d.organizacao_id = p_org and d.cnpj = c.cnpj)
    and (p_apos_cnpj is null or c.cnpj > p_apos_cnpj)
  order by c.cnpj
  limit least(greatest(coalesce(p_limite, 50), 1), 200)
$$;

drop function if exists prospeccao_contar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text);
create function prospeccao_contar(
  p_org uuid,
  p_cnaes text[], p_secundarios boolean, p_ufs text[], p_municipios text[],
  p_portes text[], p_excluir_mei boolean, p_so_com_email boolean, p_texto text
) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*)
  from catalogo_estabelecimentos c
  where prospeccao_filtro_ok(c, p_cnaes, p_secundarios, p_ufs, p_municipios,
                             p_portes, p_excluir_mei, p_so_com_email, p_texto)
    and not exists (
      select 1 from prospeccao_descartes d
       where d.organizacao_id = p_org and d.cnpj = c.cnpj)
$$;

-- ----------------------------------------------------------------------------
-- Importação. p_itens: [{ "cnpj": "...", "email": "...|null",
--   "contato_nome": "...|null", "contato_cargo": "...|null" }]
-- Por item: cria empresa (origem catalogo_rf, com cnpj) + lead + contato e
-- liga as pontes. Status por item: importado | ja_na_base | email_ja_existe |
-- sem_email | fora_do_catalogo | duplicado_no_lote. Um item recusado não
-- afeta os demais.
-- p_simular=true roda AS MESMAS checagens e não grava nada (status
-- 'importavel' no lugar de 'importado'): a prévia da tela é esta função.
-- ----------------------------------------------------------------------------
drop function if exists prospeccao_importar(uuid, uuid, text, text, jsonb, boolean);
create function prospeccao_importar(
  p_org uuid, p_responsavel_id uuid, p_responsavel_nome text,
  p_segmento text, p_itens jsonb, p_simular boolean default true
) returns table (cnpj text, status text, lead_id uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  item jsonb;
  cat catalogo_estabelecimentos;
  v_cnpj text;
  v_email text;
  v_nome_empresa text;
  v_empresa_id uuid;
  v_contato_id uuid;
  v_lead_id uuid;
  v_vistos text[] := '{}';
  v_emails text[] := '{}';
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then
    raise exception 'p_itens deve ser um array de até 200 itens';
  end if;

  for item in select * from jsonb_array_elements(p_itens)
  loop
    v_cnpj := regexp_replace(coalesce(item->>'cnpj', ''), '\D', '', 'g');
    select * into cat from catalogo_estabelecimentos x where x.cnpj = v_cnpj;
    if not found then
      cnpj := v_cnpj; status := 'fora_do_catalogo'; lead_id := null; return next; continue;
    end if;
    if v_cnpj = any(v_vistos) then
      cnpj := v_cnpj; status := 'duplicado_no_lote'; lead_id := null; return next; continue;
    end if;
    v_vistos := v_vistos || v_cnpj;

    -- Serializa importações concorrentes do mesmo CNPJ na mesma org.
    perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || v_cnpj, 0));

    if exists (select 1 from empresas e where e.organizacao_id = p_org and e.cnpj = v_cnpj) then
      cnpj := v_cnpj; status := 'ja_na_base'; lead_id := null; return next; continue;
    end if;

    v_email := lower(nullif(trim(coalesce(item->>'email', cat.email, '')), ''));
    if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      cnpj := v_cnpj; status := 'sem_email'; lead_id := null; return next; continue;
    end if;
    if v_email = any(v_emails)
       or exists (select 1 from leads l where l.organizacao_id = p_org and lower(l.contato_email) = v_email) then
      cnpj := v_cnpj; status := 'email_ja_existe'; lead_id := null; return next; continue;
    end if;
    v_emails := v_emails || v_email;

    if p_simular then
      cnpj := v_cnpj; status := 'importavel'; lead_id := null; return next; continue;
    end if;

    v_nome_empresa := coalesce(cat.nome_fantasia, cat.razao_social, v_cnpj);

    insert into empresas (organizacao_id, nome, cnpj, dominio, segmento, cidade, estado, pais, telefone, origem)
    values (p_org, v_nome_empresa, v_cnpj, split_part(v_email, '@', 2), nullif(p_segmento, ''),
            cat.municipio, cat.uf, 'Brasil', cat.telefone, 'catalogo_rf')
    returning id into v_empresa_id;

    insert into leads (
      organizacao_id, owner, estagio, followups_enviados, canal_preferencial, perdido, score,
      empresa, segmento, cidade, estado, dominio, origem,
      contato_nome, contato_cargo, contato_email, contato_telefone,
      responsavel_id, responsavel_nome
    ) values (
      p_org, 'n8n', 'novos_leads', 0, 'email', false, 50,
      v_nome_empresa, nullif(p_segmento, ''), cat.municipio, cat.uf, split_part(v_email, '@', 2), 'catalogo_rf',
      nullif(trim(item->>'contato_nome'), ''), nullif(trim(item->>'contato_cargo'), ''), v_email, cat.telefone,
      p_responsavel_id, p_responsavel_nome
    ) returning id into v_lead_id;

    insert into contatos (organizacao_id, empresa_id, nome, cargo, email, telefone, origem)
    values (p_org, v_empresa_id, nullif(trim(item->>'contato_nome'), ''), nullif(trim(item->>'contato_cargo'), ''),
            v_email, cat.telefone, 'catalogo_rf')
    returning id into v_contato_id;

    update leads set empresa_id = v_empresa_id, contato_id = v_contato_id
     where id = v_lead_id and organizacao_id = p_org;

    cnpj := v_cnpj; status := 'importado'; lead_id := v_lead_id; return next;
  end loop;
end
$$;

do $grants$
declare
  assinatura text;
  papel text;
  assinaturas text[] := array[
    'prospeccao_buscar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text, text, integer)',
    'prospeccao_contar(uuid, text[], boolean, text[], text[], text[], boolean, boolean, text)',
    'prospeccao_importar(uuid, uuid, text, text, jsonb, boolean)'
  ];
begin
  foreach assinatura in array assinaturas
  loop
    execute format('revoke all on function %s from public', assinatura);
    foreach papel in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = papel) then
        execute format('revoke all on function %s from %I', assinatura, papel);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', assinatura);
    end if;
  end loop;

  -- Descartes: leitura pelo browser via RLS; escrita só service_role.
  foreach papel in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = papel) then
      execute format('revoke insert, update, delete on table prospeccao_descartes from %I', papel);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on table prospeccao_descartes from anon';
  end if;
end
$grants$;

notify pgrst, 'reload schema';
