-- ============================================================================
-- Migration 0034 — o papel `usuario` passa a criar campanha de comunicado
-- ----------------------------------------------------------------------------
-- Concede `campaigns.manage` a quem tem role 'usuario'. Sozinha, essa permissão
-- daria acesso a QUALQUER objetivo — o que a limita a comunicado é a ausência de
-- `campaigns.tipos.avancados` (migration 0033), verificada no servidor em
-- /api/campanhas (POST e PATCH). As duas juntas formam a regra: usuário cria
-- comunicado; prospecção, follow-up, reativação e renovação continuam com admin.
--
-- Consequência assumida: `campaigns.manage` também governa /api/campanhas/[id]/
-- enrollar, então o usuário dispara o próprio comunicado. É o comportamento
-- pedido — a campanha de comunicado é dele de ponta a ponta.
--
-- Por que precisa de migration: `permissoesEfetivas` usa `perfil_permissoes`
-- quando o perfil tem linhas, e o backfill da 0015 gravou linha a linha. Mudar
-- só PERMISSOES_POR_ROLE não alcançaria os perfis já existentes.
--
-- Aditiva e idempotente: só insere, e o `unique (perfil_id, permissao)` da 0015
-- impede duplicata em nova execução.
--
-- ESPELHO de PERMISSOES_POR_ROLE em lib/rbac/permissoes.ts — manter em sincronia.
-- ============================================================================

insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, 'campaigns.manage'
from perfis p
where p.role = 'usuario'
  and p.organizacao_id is not null
  and not exists (
    select 1 from perfil_permissoes pp
    where pp.perfil_id = p.id and pp.permissao = 'campaigns.manage'
  );
