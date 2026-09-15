import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { carregarAssetPublicoDoDisco, gerarPdfPropostaServidor } from '../pdfServidor'
import { montarDadosProposta } from '@/lib/proposta/dados'
import { PROPOSTA_BASE_IMAGEM, PROPOSTA_THUMBNAILS_DIR } from '@/lib/proposta/config'

// PDF gerado no servidor com os assets REAIS de public/proposta (o mesmo que
// vai anexado ao e-mail/WhatsApp). O vitest roda na raiz do projeto, que é o
// process.cwd() que o módulo usa — como a função na Vercel.

describe('pdfServidor', () => {
  it('lê a imagem-base e um thumbnail reais de public/', async () => {
    const base = await carregarAssetPublicoDoDisco(PROPOSTA_BASE_IMAGEM)
    expect(base?.[0]).toBe(0x89) // assinatura PNG
    expect(await carregarAssetPublicoDoDisco(`${PROPOSTA_THUMBNAILS_DIR}/coletor.png`)).not.toBeNull()
  })

  it('arquivo ausente → null (thumbnail opcional não derruba a geração)', async () => {
    expect(await carregarAssetPublicoDoDisco(`${PROPOSTA_THUMBNAILS_DIR}/nao-existe.png`)).toBeNull()
  })

  it('nunca lê fora de public/', async () => {
    expect(await carregarAssetPublicoDoDisco('/../package.json')).toBeNull()
    expect(await carregarAssetPublicoDoDisco('..\\..\\package.json')).toBeNull()
  })

  it('gera a proposta em 1 página a partir do snapshot', async () => {
    const dados = montarDadosProposta({
      modelo: 'comodato',
      itens: [{ produto: 'coletor', qtd: 1 }, { produto: 'impressora', qtd: 1 }],
      valorFinal: 0, mensalFinal: 590, entradaFinal: 3000, prazoMeses: 24,
    })
    const bytes = await gerarPdfPropostaServidor(dados)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(bytes.length).toBeGreaterThan(100_000) // imagem-base embutida
  })
})
