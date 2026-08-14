@AGENTS.md

## Pasta de contexto (specs e mockups)

Specs e mockups do projeto ficam em `C:\Users\supor\Documents\Claude\Automação & IA\`.
Quando o usuário disser "acesse a pasta", citar um arquivo `.md` ou `.png` sem anexar, ou referenciar um mockup, leia direto desse caminho com a ferramenta Read.
Se o arquivo não existir lá, avise imediatamente — não prossiga inventando conteúdo.

## Regra de processo: quem edita código aqui

Este repositório é editado **somente pelo Claude Code rodando localmente no terminal/VS Code** (`~/Documents/VS CODE/prospectos`), nunca por um agente em sandbox remoto com mount de rede (ex.: Cowork).

Motivo: sandboxes com mount de rede já causaram corrupção de arquivo (truncamento no meio de uma edição) e falhas de build (`next build` / `vitest` com "Bus error") que não acontecem rodando local.

Se você é um agente sem acesso de terminal local a este projeto: **não edite arquivos**. Em vez disso, produza um prompt/spec claro (contexto, arquivos afetados, regras de negócio a preservar, critérios de aceite) para que o Claude Code local execute a mudança, e revise o resultado quando ele for trazido de volta.
