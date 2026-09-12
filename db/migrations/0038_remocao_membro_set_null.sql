-- 0038 — Remover membro da equipe não pode ser bloqueado por atribuição.
--
-- Sintoma: "Remover da equipe" falhava com
--   update or delete on table "perfis" violates foreign key constraint
--   "workflow_versoes_publicado_por_fkey"
-- porque o membro tinha publicado uma versão de workflow. E, corrigido só isso,
-- o passo seguinte (delete em `usuarios`) falharia do mesmo jeito em
-- `leads.responsavel_id` / `interacoes.responsavel_id` — a rota engolia esse
-- erro e deixava uma linha zumbi em `usuarios`.
--
-- As três colunas são ATRIBUIÇÃO ("quem publicou", "quem é responsável"), não
-- posse. O registro de negócio (versão de workflow, lead, histórico) precisa
-- sobreviver à saída da pessoa; o que some é só o carimbo. Por isso
-- ON DELETE SET NULL, e não CASCADE. As três já são nullable e o código já
-- trata null (responsavel_id nulo é estado suportado e testado — ver
-- AGENTS.md; publicado_por é `string | null` em lib/workflows/types.ts).
--
-- Idempotente: drop if exists + add. Aditiva: não muda tipo, nulabilidade nem
-- dado — só a regra de delete das FKs.

alter table workflow_versoes
  drop constraint if exists workflow_versoes_publicado_por_fkey;
alter table workflow_versoes
  add constraint workflow_versoes_publicado_por_fkey
  foreign key (publicado_por) references perfis(id) on delete set null;

alter table leads
  drop constraint if exists leads_responsavel_id_fkey;
alter table leads
  add constraint leads_responsavel_id_fkey
  foreign key (responsavel_id) references usuarios(id) on delete set null;

alter table interacoes
  drop constraint if exists interacoes_responsavel_id_fkey;
alter table interacoes
  add constraint interacoes_responsavel_id_fkey
  foreign key (responsavel_id) references usuarios(id) on delete set null;
