-- 0031 — A renovação deixa de depender só de consulta para não duplicar.
--
-- `processarRenovacoes` roda todo dia sobre laudos que permanecem semanas na
-- mesma janela e hoje evita duplicar consultando antes de inserir. Está correto
-- e foi verificado — mas é o mesmo formato (checa, depois grava) que falhou no
-- monitor de respostas: entre a consulta e a inserção não há nada garantindo
-- exclusividade, então duas execuções simultâneas passariam as duas.
--
-- Hoje o risco é teórico (cron diário, execução única). Estes índices tornam a
-- garantia estrutural, para não depender de o agendamento nunca se sobrepor.
--
-- A chave é a mesma que o código já usa: um ciclo de renovação é identificado
-- pelo serviço (ou, no caminho legado, pelo lead) mais a data de vencimento.
-- Um vencimento novo é outro ciclo e continua criando tarefa normalmente.
--
-- Verificado antes de aplicar: 0 duplicatas nos dois caminhos.

-- Caminho principal: serviço recorrente.
create unique index if not exists uniq_tarefa_renovacao_servico
  on tarefas(organizacao_id, servico_id, prazo_em)
  where tipo = 'renovacao' and servico_id is not null;

-- Caminho legado: validade no próprio lead, sem serviço cadastrado.
create unique index if not exists uniq_tarefa_renovacao_lead_legado
  on tarefas(organizacao_id, lead_id, prazo_em)
  where tipo = 'renovacao' and servico_id is null and lead_id is not null;
