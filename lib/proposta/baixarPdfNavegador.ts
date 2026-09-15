// Download da proposta em PDF no BROWSER — botão "Gerar proposta" do Simulador
// e "Baixar PDF" das abas Propostas. O renderizador (pdf-lib) só é carregado no
// clique — import dinâmico — para não pesar a tela. Download pelo mesmo padrão
// do export CSV (Blob + <a download>).

import { nomeArquivoProposta, type PropostaPdfData } from './dados'

export async function baixarPropostaPdf(dados: PropostaPdfData, empresa?: string | null, data?: Date): Promise<void> {
  const { gerarPropostaPdf } = await import('./renderizarPdf')
  const bytes = await gerarPropostaPdf(dados, carregarAssetPublico)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = nomeArquivoProposta(empresa, data)
  link.click()
  URL.revokeObjectURL(url)
}

// Assets de public/ via fetch; 404 vira `null` (thumbnail ausente não falha).
async function carregarAssetPublico(caminho: string): Promise<Uint8Array | null> {
  const r = await fetch(caminho)
  if (!r.ok) return null
  return new Uint8Array(await r.arrayBuffer())
}
