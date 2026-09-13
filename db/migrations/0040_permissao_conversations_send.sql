-- ============================================================================
-- Migration 0040 — permissão `conversations.send` (Central de Respostas)
-- ----------------------------------------------------------------------------
-- Enviar mensagem a um lead pela Central (WhatsApp e e-mail) exigia `campaigns.operate`,
-- que é admin-only (hoje só protege o envio legado via Meta, /api/whatsapp/enviar).
-- O comercial precisa responder o lead sem receber isso. Nasce
-- `conversations.send`, escopada só às rotas da Central (/api/whatsapp/send,
-- /api/whatsapp/status, /api/email/enviar), concedida por padrão aos DOIS roles.
-- As rotas de campanha (criar/ativar/iniciar) continuam em `campaigns.manage`
-- com o gate `campaigns.tipos.avancados` — nada muda para elas.
--
-- Por que migration: `permissoesEfetivas` (lib/rbac/permissoes.ts) trata as
-- linhas de `perfil_permissoes` como autoritativas quando existem — e hoje
-- todos os perfis têm linhas (backfill da 0015). Mudar só o padrão em código
-- não alcança ninguém já cadastrado; o backfill alcança. Perfis criados depois
-- recebem pelo padrão do role (ressincronizarPermissoes).
--
-- Aditiva e idempotente (mesmo padrão da 0033/0034): não remove nada, não
-- mexe em schema, e reexecutar não duplica (guardado por NOT EXISTS + o índice
-- único perfil_id/permissao). Rollback = delete das linhas com esse slug.
-- ============================================================================

insert into perfil_permissoes (organizacao_id, perfil_id, permissao)
select p.organizacao_id, p.id, 'conversations.send'
from perfis p
where p.role in ('admin', 'usuario')
  and p.organizacao_id is not null
  and not exists (
    select 1 from perfil_permissoes pp
    where pp.perfil_id = p.id and pp.permissao = 'conversations.send'
  );
