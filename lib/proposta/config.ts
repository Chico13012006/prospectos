// Configuração do gerador de proposta em PDF (Comercial > Simulador).
// Centraliza o que pode mudar sem mexer no template: o link da apresentação
// institucional (CTA clicável do PDF) e o caminho da imagem-base em public/.
// Sem tela de configuração nesta versão — o objetivo é só não espalhar
// hardcode pelo código.

// Apresentação institucional da InovaCode aberta pelo botão
// "VER APRESENTAÇÃO COMPLETA" e pela URL visual do rodapé da proposta.
export const PROPOSTA_APRESENTACAO_URL =
  'https://www.canva.com/design/DAHE9ur1LUo/xITYQO0PuOuiOqiN6w-B2A/view?utm_content=DAHE9ur1LUo&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h84a198c07c'

// Imagem-base 16:9 da proposta aprovada, com as regiões dinâmicas vazias
// (título da modalidade, subheader, conteúdo de "Solução proposta" e bloco
// financeiro). Tudo o mais — identidade, blocos fixos, footer, CTA visual —
// vem gravado nela. Servida de public/ pelo caminho abaixo.
export const PROPOSTA_BASE_IMAGEM = '/proposta/base-proposta.png'

// Thumbnails opcionais por produto: public/proposta/produtos/<ProdutoId>.png.
// Ausência de arquivo nunca falha a geração — a linha sai só com texto.
export const PROPOSTA_THUMBNAILS_DIR = '/proposta/produtos'

// Máximo de linhas (tipos de produto) que a região "Solução proposta" comporta
// em uma página. Acima disso a UI desabilita "Gerar proposta" em vez de
// produzir PDF quebrado; não há segunda página nesta versão.
export const PROPOSTA_LIMITE_ITENS = 5
