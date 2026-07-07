# Spec — Tela de Configuração de Cadência (ProspectOS)

Objetivo: os parâmetros de cadência do motor (limite diário de envios, intervalo entre follow-ups, máximo de follow-ups, espaçamento entre envios, dias da semana ativos) hoje só mudam editando `.env.local` + redeploy. Expor isso numa tela dentro de Configurações, editável sem precisar mexer em código nem fazer deploy.

## 1. Escopo — o que entra e o que fica de fora

**Entra (dinâmico, editável pela tela, sem redeploy):**
- Limite diário de envios (`MAX_ENVIOS_DIA`)
- Horas entre follow-ups (`HORAS_ENTRE_FOLLOWUPS`)
- Máximo de follow-ups (`MAX_FOLLOWUPS`)
- Intervalo entre envios em lote, minutos (`INTERVALO_ENVIO_MIN`)
- Dias da semana ativos (hoje hardcoded seg-sex em `ehDiaUtil()`)
- E-mail de fallback do closer (`CLOSER_EMAIL`)

**Fica de fora, propositalmente (continua só em `.env.local` + redeploy):**
- `MODO_ENSAIO` (ensaio↔real) — é botão de segurança, não parâmetro de cadência. Manter fricção de redeploy pra trocar é proteção, não limitação.
- `INTERNAL_SECRET` — segredo de autenticação entre serviços, nunca deve existir em tabela que a UI lê.
- Horário exato do disparo diário do cron (hoje 9h BRT) — ver nota sobre Vercel Hobby no item 5.

## 2. Banco de dados

Nova tabela singleton (uma linha só, `id = 1`):

```sql
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
```

Salvar como `db/migrations/0005_configuracoes_motor.sql` (seguindo o padrão das migrations 0001-0004 já existentes) e rodar no Supabase SQL editor.

## 3. `lib/engine/config.ts` — config dinâmica com fallback

Hoje `engineConfig` é um objeto de getters síncronos lendo `process.env`. Trocar (ou complementar) por uma função assíncrona:

```ts
export interface ConfigMotor {
  maxEnviosDia: number
  horasEntreFollowups: number
  maxFollowups: number
  intervaloEntreEnviosMin: number
  diasSemanaAtivos: number[] // 0=domingo..6=sábado
  closerEmailFallback: string
}

export async function getEngineConfig(): Promise<ConfigMotor>
export function invalidarCacheConfig(): void
```

Regras:
- Lê de `configuracoes_motor` via `createSupabaseAdminClient()` (client de service role já existe em `lib/supabase-admin.ts`).
- Cache em memória de ~30s (evita martelar o banco a cada envio, mas reflete mudança da tela quase na hora).
- Se a leitura do banco falhar (erro, tabela vazia) → cai pros valores de `.env` como fallback seguro. O motor **nunca** trava por causa da tela de config.
- `invalidarCacheConfig()` é chamado pela API depois de salvar, pra não esperar os 30s do cache expirar sozinho.
- Manter `engineConfig.internalSecret` e `engineConfig.modoEnsaio` como getters síncronos separados, só de `.env` (não entram na tabela).
- Scripts locais em `scripts/*.ts` (piloto, testes manuais) podem continuar lendo os getters síncronos antigos de `engineConfig` direto do `.env` — não precisam ser migrados agora.

## 4. Call sites a atualizar (trocar `engineConfig.xxx` síncrono por `(await getEngineConfig()).xxx`)

- `lib/engine/flows/executarAcao.ts` — `maxFollowups`, `maxEnviosDia`, `horasEntreFollowups`
- `lib/engine/flows/followUp.ts` — `maxFollowups`, `maxEnviosDia`, `horasEntreFollowups`
- `lib/engine/flows/direcionarCloser.ts` — `closerEmailFallback`
- `lib/engine/store/supabaseStore.ts` — `leadsParaFollowup()` e `leadsEsgotadosSemResposta()` usam `horasEntreFollowups`/`maxFollowups`
- `lib/engine/index.ts`:
  - `ehDiaUtil()` hoje é hardcoded (`dia >= 1 && dia <= 5`). Mudar assinatura pra `ehDiaUtil(diasAtivos: number[], d: Date = new Date())` e checar `diasAtivos.includes(d.getDay())`.
  - `cadenciaDiaria()` passa a ler `const cfg = await getEngineConfig()` e usar `cfg.diasSemanaAtivos` na chamada de `ehDiaUtil`.
  - `escolherEmailProvider()` **não muda** — continua usando `engineConfig.modoEnsaio` síncrono (está fora do escopo dinâmico, ver item 1).

**Não precisa mudar**: `lib/engine/email/gmailProvider.ts` (modoEnsaio fica síncrono, fora do escopo), `lib/engine/http.ts` (internalSecret fica síncrono), `lib/engine/store/memoryStore.ts` (só usado em testes), `lib/engine/scheduler.ts` (scheduler local legado, não é o caminho de produção — produção usa Vercel Cron batendo direto na API route).

## 5. `vercel.json` — cron e dias da semana

Hoje: `"schedule": "0 12 * * 1-5"` (roda só seg-sex, hardcoded no cron).

**Importante**: Vercel Hobby só permite cron que roda no máximo 1x/dia — expressões mais frequentes falham no deploy. Então não dá pra fazer o cron rodar de hora em hora pra checar "é meu horário configurado?" nesse plano.

Solução: trocar pra `"schedule": "0 12 * * *"` (roda **todo dia**, sem restringir dia da semana no cron), e deixar `ehDiaUtil()` (lendo `diasSemanaAtivos` do banco) decidir se a cadência roda de verdade naquele dia. Resultado: dia da semana vira configurável pela tela sem redeploy; horário exato (9h BRT) continua fixo no `vercel.json` — só muda com redeploy, e tudo bem, é raro precisar mudar isso.

## 6. API — `app/api/configuracoes/motor/route.ts`

Autenticação: sessão de usuário logado (mesmo padrão de `app/api/perfil/route.ts`, via `createSupabaseServerClient()` + `auth.getUser()`). **Não** usar o `x-internal-secret` do motor — essa é uma tela do app, não um endpoint do motor.

- `GET` → retorna a config atual (valores da tabela, ou defaults se a linha não existir ainda).
- `POST` → recebe `{ maxEnviosDia, horasEntreFollowups, maxFollowups, intervaloEntreEnviosMin, diasSemanaAtivos, closerEmailFallback }`, valida faixas razoáveis (ex.: `maxEnviosDia` entre 1 e 500, `diasSemanaAtivos` não vazio e só valores 0-6), grava via `upsert` com `id: 1`, seta `atualizado_em`/`atualizado_por` (email do usuário logado), chama `invalidarCacheConfig()` no final.

## 7. UI — `app/configuracoes/page.tsx`, aba "Parâmetros"

Essa aba já existe hoje, mas é **100% mockup** — array hardcoded, botão "Salvar" sem handler real. Trocar por formulário de verdade:

- `useEffect` no mount: `fetch('/api/configuracoes/motor')` e popula estado local.
- Campos: limite diário (number), horas entre follow-ups (number), máximo de follow-ups (number), intervalo entre envios em minutos (number), dias da semana ativos (7 botões/checkboxes Dom-Sáb toggle), e-mail de fallback do closer (text).
- Botão "Salvar parâmetros": `POST` pra API, mostra feedback de sucesso/erro, exibe "última alteração por X em Y" depois de salvar.
- Botão "Restaurar padrão": reseta o formulário local pros defaults (40/48/3/0/seg-sex) — só grava se o usuário clicar Salvar depois.

Bônus, se fizer sentido: a aba também tem uma seção "Status do sistema" com uma linha "n8n Automation: Operacional" que já está desatualizada (n8n foi desativado). Vale corrigir esse texto já que está do lado, mas não é o foco desta spec.

## 8. Critério de aceite

1. Abrir Configurações > Parâmetros mostra os valores reais gravados no banco (não mais mockup).
2. Mudar o limite diário na tela, salvar, e confirmar que `executarAcao`/`followUp` respeitam o novo valor no próximo envio — **sem precisar redeploy**.
3. Desmarcar um dia da semana (ex.: sexta) e confirmar que a cadência não roda nesse dia (`cadenciaDiaria` retorna `{ pulado: true }`).
4. Se a tabela `configuracoes_motor` estiver vazia ou o Supabase estiver fora do ar, o motor continua funcionando com os valores do `.env` (fallback), sem quebrar.
5. `npm run build` passa sem erro de tipo.
