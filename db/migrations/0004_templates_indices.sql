-- 0004 — Índices de unicidade da tabela `templates`.
-- A tabela já existia; esta migration é ADITIVA (só índices) e idempotente.
--
-- Modelo: cada template é único por (canal, nicho, tipo), onde
--   nicho = SEGMENTO  (NULL = genérico / fallback)
--   tipo  = ESTÁGIO   (primeiro_contato, follow_up_1..3, scripts de telefone, ...)
--
-- Como o Postgres trata NULL como distinto em UNIQUE comum (deixaria entrar dois
-- genéricos para o mesmo canal/tipo), usamos DOIS índices únicos parciais:
--   1) genérico:  único por (canal, tipo) quando nicho IS NULL
--   2) por nicho: único por (canal, nicho, tipo) quando nicho IS NOT NULL
-- Esses índices também servem de lookup para a seleção do motor
-- (lib/engine/store/supabaseStore.ts → buscarTemplateEmail).

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_generico
  ON templates (canal, tipo)
  WHERE nicho IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_por_nicho
  ON templates (canal, nicho, tipo)
  WHERE nicho IS NOT NULL;
