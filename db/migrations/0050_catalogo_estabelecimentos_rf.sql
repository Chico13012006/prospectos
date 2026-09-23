-- ============================================================================
-- Migration 0050 — Catálogo de estabelecimentos da Receita Federal
-- ----------------------------------------------------------------------------
-- Base da tela de prospecção: a busca por CNAE/UF/município/porte consulta
-- esta tabela, alimentada pelo ETL `scripts/catalogo-rf-carregar.ts` a partir
-- dos dados abertos da RF (Estabelecimentos + Empresas + Simples + Municipios).
-- A OpenCNPJ só consulta CNPJ a CNPJ — não serve para buscar.
--
-- EXCEÇÃO DELIBERADA AO ISOLAMENTO POR ORGANIZAÇÃO (AGENTS.md):
--   O catálogo é dado público e idêntico para todo tenant. Duplicá-lo por
--   organização multiplicaria o armazenamento sem ganho de isolamento. Em
--   troca, a tabela é INVISÍVEL ao cliente: RLS ligada SEM nenhuma policy e
--   privilégios revogados de anon/authenticated. Só o service_role lê, no
--   servidor, depois de `resolverAcesso()`. Tudo que é da organização (perfil
--   de busca, descartes, importações) vive em tabelas próprias, isoladas.
--
-- Só entram matrizes ATIVAS cujo CNAE principal ou secundário está na lista
-- pedida na carga. `mes_rf` marca a última carga que viu a linha; a limpeza
-- de linhas que saíram da RF é feita pelo ETL, escopada aos CNAEs da carga.
--
-- IDEMPOTENTE: create ... if not exists; revokes repetíveis.
--
-- ROLLBACK (dado derivado, reconstruível rodando o ETL de novo):
--   drop table if exists catalogo_rf_cargas;
--   drop table if exists catalogo_estabelecimentos;
-- ============================================================================

create table if not exists catalogo_estabelecimentos (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  cnpj_basico text not null check (cnpj_basico ~ '^[0-9]{8}$'),
  razao_social text,
  nome_fantasia text,
  cnae_principal text not null check (cnae_principal ~ '^[0-9]{7}$'),
  cnaes_secundarios text[] not null default '{}',
  -- Porte da RF: 'nao_informado' | 'micro' | 'pequeno' | 'demais'.
  porte text,
  -- Optante do MEI no arquivo Simples. null = empresa ausente do arquivo.
  mei boolean,
  natureza_juridica text,
  capital_social numeric(18, 2),
  data_inicio_atividade date,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cep text,
  uf text,
  municipio_codigo text,
  municipio text,
  telefone text,
  email text,
  mes_rf text not null check (mes_rf ~ '^[0-9]{4}-[0-9]{2}$'),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_catalogo_cnae_uf_municipio
  on catalogo_estabelecimentos (cnae_principal, uf, municipio_codigo, cnpj);
create index if not exists idx_catalogo_cnaes_secundarios
  on catalogo_estabelecimentos using gin (cnaes_secundarios);
create index if not exists idx_catalogo_uf_municipio
  on catalogo_estabelecimentos (uf, municipio_codigo);
create index if not exists idx_catalogo_mes_rf
  on catalogo_estabelecimentos (mes_rf);

-- Registro de cada carga: quando rodou, sobre qual mês/CNAEs, e o resultado.
-- A tela usa para mostrar "catálogo atualizado em ..." com dado real.
create table if not exists catalogo_rf_cargas (
  id uuid primary key default gen_random_uuid(),
  mes_rf text not null check (mes_rf ~ '^[0-9]{4}-[0-9]{2}$'),
  cnaes text[] not null,
  shards integer[] not null,
  completa boolean not null,
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'concluida', 'erro')),
  linhas_lidas bigint not null default 0,
  estabelecimentos_gravados integer not null default 0,
  estabelecimentos_removidos integer not null default 0,
  erro text,
  iniciada_em timestamptz not null default now(),
  concluida_em timestamptz
);

create index if not exists idx_catalogo_rf_cargas_iniciada
  on catalogo_rf_cargas (iniciada_em desc);

alter table catalogo_estabelecimentos enable row level security;
alter table catalogo_rf_cargas enable row level security;

-- Os default privileges do Supabase concedem acesso a anon/authenticated em
-- toda tabela nova do schema public (ver 0048). RLS sem policy já nega, mas o
-- revoke deixa a intenção explícita e sobrevive a uma policy criada por engano.
do $grants$
declare
  tabela text;
  papel text;
begin
  foreach tabela in array array['catalogo_estabelecimentos', 'catalogo_rf_cargas']
  loop
    execute format('revoke all on table %I from public', tabela);
    foreach papel in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = papel) then
        execute format('revoke all on table %I from %I', tabela, papel);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select, insert, update, delete on table %I to service_role', tabela);
    end if;
  end loop;
end
$grants$;
