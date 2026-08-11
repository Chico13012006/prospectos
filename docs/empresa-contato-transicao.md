# Empresa × Contato — fonte da verdade durante a transição

Estado atual (Fase 2c). A separação Empresa/Contato foi introduzida de forma
aditiva: `empresas` e `contatos` existem e foram **backfillados** a partir de
`leads` (Fase 2b), e `leads.empresa_id` / `leads.contato_id` ligam cada lead à
sua projeção. **As escritas ainda acontecem SÓ em `leads`** — as telas de
produção e o motor continuam operando sobre `leads`.

Por isso, nesta fase, a fonte da verdade é **`leads` para tudo que as telas/motor
podem alterar**, e `empresas`/`contatos` são a fonte apenas do que não existe em
`leads` (campos próprios da entidade e o relacionamento 1 empresa → N contatos).

## Tabela de fonte da verdade por campo

| Campo | Fonte durante a transição | Observação |
|---|---|---|
| Estágio, owner, score, próxima ação, responsável, follow-ups | **leads** | motor só lê/escreve `leads` |
| Empresa: nome, cidade, estado, segmento, site, domínio | **leads** (autoritativo) | `empresas` é projeção; pode divergir até a Fase 2d |
| Contato: nome, cargo, email, telefone | **leads** (autoritativo) | idem |
| Empresa: **cnpj** | **empresas** | `leads` não tem cnpj |
| Empresa: revisao_pendente, motivo_revisao, arquivado, origem | **empresas** | campos só-entidade |
| Contato: email_validado, whatsapp, linkedin, senioridade, arquivado, origem | **contatos** | campos só-entidade |
| Relacionamento (empresa ↔ vários decisores) | **empresas/contatos** | `leads` é 1:1; única fonte da estrutura |

## Como a camada de leitura evita divergência (Fase 2c)

`lib/empresas/view.ts` (puro) + `lib/empresas/repository.ts` (I/O server-only)
montam um `EmpresaView`/`ContatoView` que **sobrepõe os campos do lead** (fonte
autoritativa) sobre a projeção da entidade. Assim, se um lead for alterado, a
leitura reflete o novo valor na hora — não há divergência de leitura mesmo antes
do write-sync. Campos só-entidade vêm da entidade; sem vínculo, o view cai em
**fallback legado** derivado do próprio lead (`fonte='legado'`).

Esta camada é **opt-in**: nenhuma tela de produção a usa ainda. Ela só será
ligada nas telas **depois** da Fase 2d.

## Próximos passos da transição

- **Fase 2d — write-sync transacional**: toda gravação em `leads` (core de
  empresa/contato) passa a atualizar `empresas`/`contatos` na MESMA transação,
  eliminando a divergência. A partir daí a projeção deixa de ser "possivelmente
  velha".
- **Fase 2e — validação** e só então **ligar** o read layer nas telas, virando a
  fonte da verdade dos campos de empresa/contato para as entidades.

## Fase 2e — validação e ativação gradual

**Validação executada** (`scripts/validar-consistencia-2e.ts`, todas as orgs):
- **Equivalência: 520 leads, 0 diferenças** entre o adapter (view) e a leitura
  legada nos campos exibidos → ligar o adapter **não muda nenhum dado de tela**.
- Divergências nas tabelas subjacentes: só em `empresas.nome` (1 na org padrão,
  6 na org 2), resíduo do backfill que mesclou grafias diferentes de irmãos. Sem
  impacto: o view usa o lead como fonte; o write-sync (2d) converge no próximo edit.
- Trigger `trg_sync_lead_entidades` presente/habilitado; overhead **desprezível**.

**Flag de ativação** (`lib/empresas/flag.ts`): config tipada POR ORG em
`organizacoes.configuracoes` → `features.empresaContatoReads` (ausente/false =
legado; true = liga). Resolvida SEMPRE no servidor; sem env, sem NEXT_PUBLIC, sem
ID exposto. Ligar/desligar: `npx tsx scripts/set-workspace-feature.ts <orgId>
empresaContatoReads <true|false>` — efeito imediato, sem deploy (rollback
instantâneo). Migrou da env `EMPRESA_CONTATO_READS(_ORGS)`, que quebrou em
produção (GET /api/flags retornava false até para a org habilitada). Primeira
superfície ligada (menor risco): endpoint aditivo `GET /api/leads/[id]/entidades`
— nenhuma tela existente depende dele.

**Ordem de ativação recomendada (tela por tela, com QA visual e rollback):**
1. Endpoint `entidades` (feito — aditivo, zero risco).
2. Base de Leads (lista, read-only).
3. LeadPanel (detalhe) — aba Empresa/Decisores.

**Checklist de QA na interface real (antes de cada flip):** editar lead (nome/
email do contato), empresa com múltiplos contatos (decisores), importação,
pipeline (arrastar estágio), responsável, próxima ação, execução de workflow —
confirmar que o dado exibido é idêntico ao legado. Requer login; é o passo
humano final antes de declarar a Fase 2 concluída.

## Acabamento da Fase 2 — reconciliação da projeção

A env `EMPRESA_CONTATO_READS(_ORGS)` foi **aposentada**: a flag vive só em
`organizacoes.configuracoes → features.empresaContatoReads` (config por org,
resolvida no servidor). Superfícies ligadas hoje: endpoint `entidades` e o
LeadPanel (aba Empresa/Decisores), ambos gated por org. A **Base de Leads
(lista) NÃO foi religada de propósito**: a view é leads-autoritativa em todos os
campos core, então a lista mostraria dado idêntico ao legado — sem ganho e com
superfície de QA extra. Fica para quando a lista passar a exibir campos
só-entidade (cnpj/decisores).

**Reconciliação da projeção** (`scripts/reconciliar-projecao-entidades.ts`): o
backfill 2b só copiou `nome/cnpj/dominio` para `empresas`; `cidade/estado` (e o
`dominio` derivado depois) ficaram velhos/nulos na projeção até um edit disparar
o trigger 2d. O script força AGORA a convergência que o trigger faria, de forma
CONSERVADORA — mexe SÓ na projeção (nunca em `leads`) e só quando os leads irmãos
de uma empresa CONCORDAM; empresas cujos irmãos discordam de grafia ficam
intocadas (decisão humana). Executado (`apply`): 393 empresas convergidas (283
cidade/estado da org Laudos + domínios + 4 nomes), 3 empresas ambíguas
preservadas, 0 contatos (contatos já vinham completos do backfill). Idempotente
(2ª execução = no-op). A equivalência de leitura seguiu **0 diferenças**
(`validar-consistencia-2e.ts`): a reconciliação não muda nada exibido, só torna a
projeção auto-consistente para leituras diretas da entidade (decisores/relatórios).
