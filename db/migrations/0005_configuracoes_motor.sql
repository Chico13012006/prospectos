-- 0005 — Tabela singleton de configuração dinâmica do motor de cadência.
-- Parâmetros editáveis pela tela Configurações > Parâmetros, sem redeploy.
-- MODO_ENSAIO e INTERNAL_SECRET ficam FORA de propósito (só .env + redeploy):
-- o primeiro é botão de segurança, o segundo é segredo entre serviços.
-- O motor lê via lib/engine/config.ts (getEngineConfig, cache ~30s) e cai
-- pros valores do .env se esta tabela estiver vazia ou inacessível.

CREATE TABLE IF NOT EXISTS configuracoes_motor (
  id smallint PRIMARY KEY DEFAULT 1,
  max_envios_dia integer NOT NULL DEFAULT 40,
  horas_entre_followups integer NOT NULL DEFAULT 48,
  max_followups integer NOT NULL DEFAULT 3,
  intervalo_entre_envios_min integer NOT NULL DEFAULT 0,
  -- CSV de dias ativos, convenção JS Date.getDay(): 0=domingo .. 6=sábado.
  dias_semana_ativos text NOT NULL DEFAULT '1,2,3,4,5',
  closer_email_fallback text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por text,
  CONSTRAINT configuracoes_motor_singleton CHECK (id = 1)
);

INSERT INTO configuracoes_motor (id, max_envios_dia, horas_entre_followups, max_followups, intervalo_entre_envios_min, dias_semana_ativos)
VALUES (1, 40, 48, 3, 0, '1,2,3,4,5')
ON CONFLICT (id) DO NOTHING;
