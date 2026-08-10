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
