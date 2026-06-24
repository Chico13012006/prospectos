# Motor de Automação (engine)

Substitui, aos poucos, os fluxos do n8n. Roda **dentro deste projeto Next.js**,
sobre o mesmo Supabase. Começa em **modo de ensaio** (não envia nada) e só age em
leads explicitamente liberados (`owner='engine'`).

## Os 4 fluxos

| # | Fluxo | Arquivo | Endpoint |
|---|-------|---------|----------|
| 1 | Executar ação (1º contato / próxima ação) | `flows/executarAcao.ts` | `POST /api/engine/executar-acao` |
| 2 | Detectar resposta (caixa Gmail) | `flows/detectarResposta.ts` | `POST /api/engine/detectar-resposta` |
| 3 | Direcionar ao closer | `flows/direcionarCloser.ts` | (enfileirado pelo fluxo 2) |
| 4 | Follow-up (cron, dias úteis) | `flows/followUp.ts` | `GET/POST /api/engine/follow-up` |

`/api/engine/follow-up` sem parâmetros roda a **cadência diária completa**
(detectar → fila/closer → follow-up). Use `?modo=followup` para só o fluxo 4 e
`?forcar=1` para ignorar a checagem de dia útil.

> O endpoint legado `/api/executar-acao` (proxy do n8n) **continua intacto**.

## Arquitetura (portas e adaptadores)

Os fluxos só conhecem **interfaces**, nunca o Supabase/Gmail direto — por isso dá
para testar sem rede e trocar implementações sem reescrever os fluxos.

- `store/store.ts` → `SupabaseStore` (real) | `MemoryStore` (testes/demo)
- `email/provider.ts` → `SimulatedProvider` (ensaio) | `GmailProvider` (real, stub)
- `queue.ts` → fila com **retry + escaninho de erro (dead-letter)**
- `logger.ts` → log estruturado (1 linha JSON por evento)

## Trava de migração (segurança)

A coluna `leads.owner` tem **DEFAULT `'n8n'`**. Todos os leads existentes seguem
com o n8n; o motor **não toca em nada** até você liberar um lead:

```sql
-- liberar um lead para o motor
update leads set owner = 'engine' where id = '<lead_id>';
-- devolver ao n8n
update leads set owner = 'n8n' where id = '<lead_id>';
```

## Modo de ensaio

`MODO_ENSAIO=true` (padrão) ⇒ nada é enviado: o provedor apenas **loga o que
faria**. Para enviar de verdade: configure as credenciais do Gmail e
`MODO_ENSAIO=false`.

## Variáveis de ambiente (`.env.local`)

```bash
MODO_ENSAIO=true            # padrão; nada é enviado de verdade
MAX_ENVIOS_DIA=40           # teto diário de envios
HORAS_ENTRE_FOLLOWUPS=48    # espera mínima entre follow-ups
MAX_FOLLOWUPS=3             # máximo de follow-ups por lead
CLOSER_EMAIL=               # fallback p/ closer (se o lead não tiver responsável)

# Já existentes (reusados): SUPABASE_SERVICE_ROLE_KEY, INTERNAL_SECRET
# Gmail real (só quando MODO_ENSAIO=false):
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_REMETENTE="Francisco | iNOVACODE <francisco@inovacode.com.br>"
```

Os endpoints exigem o header `x-internal-secret: <INTERNAL_SECRET>` (ou
`Authorization: Bearer <INTERNAL_SECRET>`).

## Setup

1. Aplique a migration `db/migrations/0001_engine_owner_trava.sql` no SQL Editor
   do Supabase (é aditiva e idempotente).
2. Garanta as variáveis acima no `.env.local` (mantenha `MODO_ENSAIO=true`).
3. Rode os testes: `npm test`
4. Veja os 4 fluxos em ação (ensaio, sem rede): `npm run engine:demo`

## Scheduler (node-cron, dias úteis)

`lib/engine/scheduler.ts` agenda a **cadência diária** (detectarResposta → fila/closer
→ followUp) em dias úteis. Roda contra Supabase/Gmail reais e respeita `MODO_ENSAIO`
(em ensaio o envio é só logado; as escritas no banco acontecem, restritas a
`owner='engine'`). Usa o GmailProvider quando há credenciais, para LER a caixa real
mesmo em ensaio.

```bash
# Deixa rodando: dispara seg–sex às 9h (America/Sao_Paulo)
npm run engine:scheduler

# Roda a cadência UMA vez agora (para teste; ignora a checagem de dia útil)
npm run engine:cadencia-once

# Teste sem enviar e-mail de verdade (escritas no banco ainda ocorrem):
#   $env:MODO_ENSAIO='true'; npm run engine:cadencia-once   (PowerShell)
```

Configurável por env: `CRON_FOLLOWUP` (padrão `0 9 * * 1-5`) e `CRON_TZ`
(padrão `America/Sao_Paulo`). O scheduler usa `noOverlap` (não roda concorrente).

**Alternativa serverless** — Vercel Cron (`vercel.json`), chamando o endpoint:

```json
{ "crons": [{ "path": "/api/engine/follow-up", "schedule": "0 9 * * 1-5" }] }
```

(O próprio fluxo também checa dia útil; `?forcar=1` ignora a checagem.)

## Idempotência (nunca reenviar)

- **1º contato**: só envia se ainda **não houver** interação `abordagem` (ia) do lead.
- **Follow-up**: conta interações `follow_up` (ia); respeita `MAX_FOLLOWUPS` e o
  gate de tempo (`proxima_acao_data`, com fallback `ultimo_contato + intervalo`).
- **Resposta**: ao detectar, o lead sai da esteira (`estagio='interessado'`), então
  o follow-up nunca mais o pega.

## Mapeamento de estágios (reuso, sem coluna nova)

O motor usa o vocabulário de `estagio` **deste** projeto (igual à UI do pipeline):
`novos_leads → primeiro_contato → aguardando_resposta → follow_up → interessado →
reuniao_agendada` (+ `perdido`).

- Resposta detectada ⇒ `estagio='interessado'` (pausa a cadência).
- Direcionado ao closer ⇒ `estagio='interessado'` **+** `proxima_acao='com_closer'`
  (o marcador de ciclo de vida vive na coluna existente `proxima_acao`, sem
  inventar coluna nem quebrar o agrupamento da UI).
- "nicho" = coluna existente `segmento`.

## Testes

`npm test` cobre: auto-resposta ignorada, casamento por domínio (e via coluna
`dominio`), pausa ao responder, limite diário, não-reenvio (idempotência),
trava `owner`, fila com retry e dead-letter, e a integração detectar→closer.
