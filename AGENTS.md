<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ProspectOS — regras permanentes

## Antes de agir

- Edite este repositório somente na cópia local, com acesso direto ao filesystem (`C:\Users\supor\Documents\VS CODE\prospectos`). Um agente preso a sandbox remoto ou mount de rede não deve editar: esses ambientes já truncaram arquivos e produziram falhas `Bus error` não reproduzíveis localmente em `next build`/Vitest. Nesse caso, entregue uma spec para execução local. Um agente desktop com acesso direto a este workspace pode editar quando a tarefa do usuário autorizar.
- Preserve mudanças preexistentes do usuário. Comece por `git status --short`, inspecione sobreposições e nunca reverta, formate ou inclua arquivos fora do escopo.
- Specs e mockups externos ficam em `C:\Users\supor\Documents\Claude\Automação & IA\`. Quando o usuário citar um arquivo dessa pasta sem anexá-lo, leia o original; se estiver ausente ou inacessível, avise e não invente conteúdo.
- Use `npm` e o `package-lock.json` existente. Não crie outro lockfile.

## Fontes de verdade

| Tema | Fonte e precedência |
|---|---|
| Comportamento atual | Código, migrations, testes, `package.json` e `vercel.json` prevalecem sobre narrativas antigas. |
| Next.js | Antes de alterar código Next.js, leia o guia pertinente em `node_modules/next/dist/docs/`; não use APIs lembradas de outras versões. |
| Empresa × Contato | Leia `docs/empresa-contato-transicao.md` inteiro. A seção final “Acabamento da Fase 2” descreve o estado mais recente; as seções 2c/2d anteriores são histórico da transição. |
| Motor de cadência | `lib/engine/README.md` explica a arquitetura e as travas originais, mas antecede evoluções posteriores. Confirme cron, providers, configuração e fluxos em `lib/engine/**`, testes e `vercel.json`. |
| Specs de feature | `spec-*.md` registra requisitos/aceites de entregas específicas; não é backlog permanente nem prova de que o estado descrito ainda esteja pendente. |
| README raiz | É o boilerplate do Create Next App, não documentação operacional do ProspectOS. |

## Invariantes protegidas

- Autenticação e autorização são impostas no servidor. Em APIs de usuário, use `resolverAcesso()`/`exigirPermissao()`; esconder controles no frontend não substitui RBAC.
- O sistema é multi-tenant. `service_role` ignora RLS: toda leitura, inserção, atualização e exclusão feita com client admin deve gravar/filtrar `organizacao_id` explicitamente, inclusive operações por `id`. Obtenha a organização da sessão/perfil ou de um iterador interno confiável, nunca do payload do cliente.
- Tabela ou fluxo persistente novo precisa de isolamento por organização, RLS como backstop, índices pertinentes e teste de isolamento que prove que outra organização não é lida nem alterada.
- Configuração por workspace e feature flags pertencem ao blob tipado `organizacoes.configuracoes`, passam por `parseWorkspaceConfig`/`serializeWorkspaceConfig` e são resolvidas no servidor. Não use env, `NEXT_PUBLIC_*`, IDs expostos ou flags globais para habilitar uma única organização; esse desenho já falhou em produção.
- Na transição Empresa/Contato, `leads` continua autoritativa para os campos core compartilhados e o trigger da migration `0018` sincroniza a projeção. Campos exclusivos e o relacionamento 1:N pertencem a `empresas`/`contatos`. Não contorne essa direção nem remova fallbacks/flags sem seguir `docs/empresa-contato-transicao.md` e validar equivalência.
- Não presuma que dados legados têm todas as FKs preenchidas. Em particular, preserve os fallbacks testados para `responsavel_id` nulo/`responsavel_nome` legado e resolva IDs nas novas escritas.
- Migrations já aplicadas são imutáveis. Mudanças de schema entram em uma nova migration numerada, preferencialmente aditiva e idempotente; qualquer operação destrutiva exige plano explícito de dados e rollback.
- Nunca exponha ou versione segredos e dados de clientes. Trate `.env.local`, `.claude/settings.local.json`, `hubspot_leads.csv`, `backups/`, `data/prospeccao/` e `lote-*.log` como material local/sensível; um eventual exemplo de env deve conter apenas placeholders. Não reproduza valores reais em logs, diffs ou respostas.
- Scripts em `scripts/` podem aplicar migrations, escrever no Supabase, inscrever leads ou enviar mensagens. Inspecione o script e prefira `dry-run`/report; não execute mutações contra banco conectado, flips de flag ou envio real sem autorização explícita e organização-alvo confirmada.

## Automações e efeitos externos

- Preserve todas as travas de envio: `owner='engine'`, opt-out, bounce, idempotência de abordagem/follow-up, `MODO_ENSAIO`, `campanhas.dry_run` (default seguro `true`) e `RENOVACAO_ENVIO_REAL`. Lead bounced/opt-out não volta à esteira nem a enrollment automático por mudança incidental de estágio.
- Simulação ou `dryRun` deve ser realmente sem efeitos persistentes: não envia, não grava, não cria tarefa e não altera execuções reais. Teste os dois caminhos quando modificar uma ação externa.
- Workflows publicados são versionados e imutáveis; cada execução permanece presa à versão inicial. Edições vão para rascunho e publicação cria nova versão. Se o formato de configuração de um bloco mudar, crie um novo tipo em vez de reinterpretar versões antigas; referências entre passos usam IDs estáveis, não índices.
- A UI deve bloquear cedo as mesmas pré-condições do backend (por exemplo, só inscrever campanha em workflow publicado). Ações em massa devem manter prévia, contagem do público e confirmação explícita acima do limite de segurança.
- Não invente métricas, integrações, timelines ou estados de sucesso. Quando o dado não existir, mostre estado vazio, “não calculável”, erro honesto ou controle desabilitado; não deixe botão que pareça funcional sem efeito real.

## Desempenho e compatibilidade

- Listas grandes de leads permanecem paginadas/virtualizadas; não busque toda a base. Ordenação paginada precisa de desempate único (normalmente `id`) e buscas concorrentes no cliente devem impedir que resposta antiga sobrescreva a nova.
- Nos filtros de cadastro de leads, preserve intervalos UTC meio-abertos (`[início, próximo dia)`) alinhados à exibição; não troque para horário local sem evidência e testes de borda.
- Prefira evolução aditiva, fallback seguro e rollback por organização. Não substitua silenciosamente rotas, campos ou comportamentos legados ainda consumidos.

## Validação

Execute em proporção ao risco, nesta ordem:

1. Teste focado: `npx vitest run <arquivo-de-teste>`.
2. Suíte completa: `npm test`.
3. Tipos: `npx tsc --noEmit`.
4. Build de produção: `npm run build`.

Não há script `lint` no `package.json`; não alegue ter executado lint. Para mudança só documental, valide o diff, links/caminhos e comandos citados; os gates da aplicação são dispensáveis. Para UI, complemente com QA no navegador autenticado e na organização afetada. Testes E2E em scripts que usam banco real não fazem parte do gate padrão e obedecem à autorização de mutação acima.

## Critérios de conclusão

- Os critérios de aceite da tarefa foram verificados um a um, incluindo caminhos de erro, isolamento multi-tenant, idempotência e modo de simulação quando aplicáveis.
- `git diff --check`, `git status --short` e o diff restrito aos arquivos da tarefa não mostram alteração acidental, segredo, PII, artefato gerado ou mudança do usuário incorporada.
- Testes/tipos/build pertinentes passaram. Qualquer gate não executado ou falha preexistente é informado claramente; não declare QA visual, banco ou produção validados sem tê-los verificado.
- Documentação e comentários descrevem o estado entregue, não uma fase futura. Instruções históricas conflitantes são apontadas e não copiadas como regra atual.
