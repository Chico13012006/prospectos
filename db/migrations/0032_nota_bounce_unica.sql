-- 0032 — Trava de última instância contra a nota de bounce duplicada.
--
-- Contexto: a idempotência real vive na aplicação (migration 0030,
-- `mensagens_processadas`). Ela só protege quem executa o código atual — e o
-- incidente de 05–07/09/2026 mostrou que isso não basta: no plano Hobby o
-- agendamento só roda uma vez por dia, então a detecção de resposta usa uma
-- fila que se reagenda a cada 120s. Essa corrente fica presa ao deployment que
-- a criou, e deployments antigos continuam vivos nas próprias URLs. Resultado:
-- código anterior à correção seguiu escrevendo por dias, indiferente a novos
-- deploys, e produziu 4.545 notas idênticas em 4 leads.
--
-- Um índice no banco não depende de qual código está rodando. Quem tentar
-- gravar a segunda nota de bounce do mesmo lead recebe violação de unicidade e
-- não duplica — inclusive o código velho.
--
-- Escopo deliberadamente estreito: só as notas cuja descrição começa com o
-- texto de bounce. Qualquer outra interação do lead continua livre, porque o
-- histórico normal (respostas, follow-ups, notas do time) precisa repetir.
--
-- Consequência aceita: um lead terá no máximo UMA nota de bounce. Como o lead
-- também é marcado `bounced` e sai de todos os fluxos, uma segunda nota não
-- acrescenta informação. Se um dia for preciso registrar um novo bounce após
-- correção do e-mail, use um texto diferente ou revise este índice.
--
-- Aplicado depois de limpar as duplicatas (restavam 12 notas, uma por lead).

create unique index if not exists uniq_interacao_bounce_por_lead
  on interacoes(organizacao_id, lead_id)
  where descricao like 'Bounce SMTP detectado%';
