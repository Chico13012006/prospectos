-- 0030 — Idempotência por MENSAGEM na leitura da caixa de entrada.
--
-- Problema que esta tabela fecha: o provedor Gmail varre uma JANELA de dias e
-- deliberadamente não depende da flag \Seen (para não perder resposta que o
-- usuário abriu no celular). Consequência: a mesma mensagem reaparece em TODA
-- passada do monitor, que se reagenda a cada 120s. Sem registro do que já foi
-- processado, cada passada reprocessa o passado inteiro.
--
-- As guardas anteriores eram heurísticas e cada uma cobria só um sintoma:
--   * lead já marcado como bounced  -> não regravar bounce
--   * mensagem anterior ao ciclo    -> não tratar como resposta nova
-- Elas dependem do estado do LEAD, então qualquer caminho novo volta a duplicar.
-- A identidade da MENSAGEM é o invariante certo: processou uma vez, nunca mais.
--
-- Chave: Message-ID (RFC 5322), único global e estável entre caixas. Quando a
-- mensagem não traz o cabeçalho, o chamador cai para mailbox+UID do IMAP.
-- Escopo por organização porque cada uma lê a própria caixa.

create table if not exists mensagens_processadas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  mensagem_id text not null,
  -- O que a mensagem virou: resposta | bounce | auto_resposta | ignorada.
  -- Serve para auditar por que um e-mail não gerou ação, sem reprocessar.
  resultado text,
  lead_id uuid references leads(id) on delete set null,
  processado_em timestamptz not null default now()
);

-- A trava de verdade: uma mensagem por organização, uma vez só. O código faz
-- INSERT ... ON CONFLICT DO NOTHING e usa a contagem de linhas afetadas para
-- decidir se processa — assim duas passadas concorrentes não duplicam.
create unique index if not exists uniq_mensagens_processadas_org_mensagem
  on mensagens_processadas(organizacao_id, mensagem_id);

-- Poda: a janela de leitura é de 30 dias, então linhas muito antigas não têm
-- mais utilidade e podem ser removidas por rotina de limpeza.
create index if not exists idx_mensagens_processadas_processado_em
  on mensagens_processadas(processado_em);

alter table mensagens_processadas enable row level security;

-- Escrita é exclusiva do motor (service_role, que ignora RLS). Para usuários
-- autenticados a tabela é somente leitura e restrita à própria organização —
-- é material de auditoria, não de operação.
drop policy if exists mensagens_processadas_leitura on mensagens_processadas;
create policy mensagens_processadas_leitura on mensagens_processadas
  for select
  using (organizacao_id = current_org_id());
