# Spec — Prospecção Free-Tier: Piloto Hotelaria

Objetivo: montar um pipeline de captação de leads NOVOS (não os 200 do HubSpot) gastando zero em ferramenta, pra medir taxa de resposta/fechamento real antes de decidir se vale pagar Speedio ou outra coisa. Nicho piloto: **Hotelaria**. Volume alvo: 25-40 leads/mês, de propósito pequeno — é teste, não escala.

## 1. Fonte de dados — CNAE (gratuita)

Usar a **OpenCNPJ** (https://opencnpj.org/) como fonte primária:
- API pública, sem autenticação, sem custo, limite de 50 req/s por IP.
- Suporta filtro por CNAE.
- Alternativa: dataset completo em Parquet pra download, se a API não cobrir o caso de uso.
- Documentação: https://opencnpj.org/docs (conferir o endpoint exato de busca/filtro antes de implementar — a doc é estática, vale abrir no navegador pra ver o formato de query).

CNAEs do nicho piloto (confirmados no IBGE/Concla, grupo 55.10 — Hotéis e Similares):
- `5510-8/01` — Hotéis
- `5510-8/02` — Apart-hotéis

Filtro adicional recomendado: situação cadastral = ATIVA, e se o campo de porte estiver disponível, excluir MEI (dificilmente é o decisor certo pro produto).

**Fallback**, se a OpenCNPJ não cobrir bem: dados abertos da própria Receita Federal (https://www.gov.br/receitafederal/dados), gratuitos, mas exigem baixar e processar os arquivos brutos — mais trabalho de engenharia, usar só se a OpenCNPJ não entregar o necessário.

## 2. Enriquecimento — decisor, e-mail, tese comercial

**Decisor**: a OpenCNPJ traz o quadro societário (sócios) no retorno de cada CNPJ. Pra hotel pequeno/médio, o sócio-administrador costuma ser o decisor de compra — usar esse nome como contato principal nesta fase (não é tão preciso quanto o "gerente de compras" mapeado que a Speedio venderia, mas é gratuito e suficiente pro teste).

**E-mail**: usar Hunter.io, tier gratuito (50 verificações/mês, pra sempre, sem cartão). Precisa:
1. Criar conta em https://hunter.io (grátis).
2. Gerar API key em Settings > API.
3. Adicionar `HUNTER_API_KEY` no `.env.local`.

**Tese comercial**: usar Tavily, tier gratuito (1.000 créditos/mês). Precisa:
1. Criar conta em https://tavily.com (grátis).
2. Gerar API key.
3. Adicionar `TAVILY_API_KEY` no `.env.local`.
4. Prompt de pesquisa: buscar sinais públicos do hotel (site, porte, se já usa algum sistema de controle de estoque/ativos) e gerar 2-3 frases de abertura personalizada — mesmo padrão de "tese_comercial" que os leads existentes já usam.

## 3. Volume e limites

Capar o script em **40 leads por execução**, com folga sobre o limite gratuito do Hunter (50 verificações/mês) — assim dá pra rodar 1x/mês sem estourar tier grátis, com margem pra erro/reprocessamento.

## 4. Pipeline (novo script, não entra no cron ainda)

Local: `scripts/prospeccao-freetier-hotelaria.ts`, seguindo o padrão dos scripts existentes (`piloto-disparo-lote.ts` etc. — carrega `.env.local` manualmente, roda como processo único, log colorido de progresso).

Fluxo:
1. Consulta OpenCNPJ filtrando CNAE `5510-8/01` e `5510-8/02`, situação ativa.
2. Pra cada candidato: checa se já existe um lead com o mesmo CNPJ/domínio na tabela `leads` (evitar duplicata — usar a mesma lógica de `buscarLeadPorDominio` já existente no `SupabaseStore`).
3. Se novo: busca/valida e-mail via Hunter (respeita limite de 40/execução).
4. Roda pesquisa Tavily pra gerar a tese comercial.
5. Insere em `leads` com: `owner='engine'`, `segmento='hotelaria'`, `origem='freetier_opencnpj'`, `contato_nome` (sócio-administrador), `contato_email`, `tese_comercial`, `estagio='novo'`.
6. **Não dispara e-mail automaticamente** — só popula a base. O primeiro contato continua manual pelo painel (Executar Ação), ou entra na cadência normal depois que você revisar a lista.

Isso é proposital: mantém controle humano na primeira leva, igual a especialista da Speedio recomendou (começar manual antes de automatizar em escala).

**Revisão da amostra**: não precisa de tela nova. Os leads aparecem na Base de Leads existente (filtrar por segmento "hotelaria" ou ordenar por mais recentes) — dar uma olhada em 5-10 antes de disparar o primeiro contato pro lote inteiro.

## 5. O que você precisa fazer antes de pedir pro Claude Code rodar isso

1. Criar conta grátis no Hunter.io e pegar a API key.
2. Criar conta grátis na Tavily e pegar a API key.
3. Adicionar as duas chaves no `.env.local` (`HUNTER_API_KEY`, `TAVILY_API_KEY`).

Sem isso o script não tem como rodar — não faz sentido pedir pra implementar antes de ter as contas criadas.

## 6. Critério de aceite

1. Rodar o script gera entre 20 e 40 leads novos de hotelaria, sem duplicar os que já existem na base.
2. Cada lead tem e-mail validado pelo Hunter (não é obrigatório 100% de acerto — Hunter às vezes não acha e-mail, nesse caso pular o lead ou marcar pra pesquisa manual).
3. Cada lead tem uma tese comercial gerada (não genérica — reflete algo real sobre a empresa).
4. Nenhum e-mail é disparado automaticamente pelo script — só populam a base pra revisão manual.
5. Rodar o script duas vezes seguidas não duplica os mesmos leads (idempotência por CNPJ/domínio).
