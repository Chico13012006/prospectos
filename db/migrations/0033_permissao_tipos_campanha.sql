-- ============================================================================
-- Migration 0033 — permissão `campaigns.tipos.avancados`
-- ----------------------------------------------------------------------------
-- Separa "criar comunicado" de "criar campanha que mexe na esteira". Prospecção,
-- follow-up, reativação e renovação inscrevem o lead numa cadência, movem
-- estágio e disputam o limite diário de envio; comunicado manda uma mensagem e
-- acaba. Quem tem `campaigns.manage` sem esta permissão passa a criar apenas
-- comunicado — enforcement em /api/campanhas (POST e PATCH), não só na tela.
--
-- Por que a migration é necessária: `permissoesEfetivas` trata
-- `perfil_permissoes` como autoritativa quando o perfil TEM linhas. O backfill
-- da 0015 gravou linha por linha, então um admin existente NÃO herdaria a
-- permissão nova ao adicioná-la em PERMISSOES_POR_ROLE — ele perderia acesso
-- que já tinha. Este backfill concede a permissão a quem é admin hoje.
--
-- Aditiva e idempotente: só insere, e o `unique (perfil_id, permissao)` da 0015
-- garante que rodar de novo não duplica. Perfis `usuario` NÃO recebem nada aqui,
-- de propósito — o alcance deles não muda com esta migration.
--
-- ESPELHO de PERMISSOES_POR_ROLE em lib/rbac/permissoes.ts — manter em sincronia.
-- ============================================================================

insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, 'campaigns.tipos.avancados'
from perfis p
where p.role = 'admin'
  and p.organizacao_id is not null
  and not exists (
    select 1 from perfil_permissoes pp
    where pp.perfil_id = p.id and pp.permissao = 'campaigns.tipos.avancados'
  );
