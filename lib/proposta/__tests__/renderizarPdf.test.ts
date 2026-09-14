import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { gerarPropostaPdf, LAYOUT, PAGINA, caixa, type CarregarAsset } from '../renderizarPdf'
import { montarDadosProposta } from '../dados'
import { PROPOSTA_APRESENTACAO_URL, PROPOSTA_BASE_IMAGEM, PROPOSTA_LIMITE_ITENS } from '../config'
import { calcularCompra, type ItemProposta } from '../../simulador'

// ---------- fixtures ----------

// PNG RGB sólido mínimo (sem dependência) para fazer as vezes da imagem-base
// e dos thumbnails. A geração real usa public/proposta/*.png.
function pngSolido(w: number, h: number, [r, g, b]: [number, number, number]): Uint8Array {
  const tabela = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = tabela[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (tipo: string, dados: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length)
    const td = Buffer.concat([Buffer.from(tipo), dados])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = r; raw[i + 1] = g; raw[i + 2] = b } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]))
}

const BASE = pngSolido(192, 108, [120, 12, 40])
const THUMB = pngSolido(20, 20, [0, 0, 0])

// Loader que simula public/: base sempre presente; thumbnails conforme o mapa.
function loader(thumbs: Record<string, Uint8Array | null> = {}): CarregarAsset {
  return async (caminho) => {
    if (caminho === PROPOSTA_BASE_IMAGEM) return BASE
    const m = caminho.match(/\/produtos\/(\w+)\.png$/)
    return m ? thumbs[m[1]] ?? null : null
  }
}

const ITENS_REF: ItemProposta[] = [
  { produto: 'coletor', qtd: 1 },
  { produto: 'impressora', qtd: 2 },
  { produto: 'totem', qtd: 4 },
]

// ---------- leitura do PDF gerado ----------

interface Inspecao { paginas: number; largura: number; altura: number; links: { uri: string; rect: number[] }[]; texto: string }

async function inspecionar(bytes: Uint8Array): Promise<Inspecao> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  const { width, height } = page.getSize()
  const annots = page.node.Annots()
  const links: Inspecao['links'] = []
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const a = doc.context.lookup(annots!.get(i), PDFDict)
    const acao = a.lookup(PDFName.of('A'), PDFDict)
    links.push({
      uri: acao.lookup(PDFName.of('URI'), PDFString).decodeText(),
      rect: a.lookup(PDFName.of('Rect'), PDFArray).asArray().map((n) => Number(n.toString())),
    })
  }
  // Texto: pdf-lib grava cada string como hex WinAnsi (`<...> Tj`) num content
  // stream Flate. WinAnsi ≈ Latin-1 para acentos; 0x97 é o travessão.
  const conteudo = page.node.Contents()
  const refs = conteudo instanceof PDFArray ? conteudo.asArray() : [conteudo]
  let texto = ''
  for (const ref of refs) {
    const stream = doc.context.lookup(ref) as PDFRawStream
    const bruto = stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents
    const ops = Buffer.from(bruto).toString('latin1')
    for (const m of ops.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      texto += Buffer.from(m[1], 'hex').toString('latin1').replace(/\x97/g, '—') + '\n'
    }
  }
  return { paginas: doc.getPageCount(), largura: width, altura: height, links, texto }
}

const dentro = (rect: number[], r: { x: number; y: number; w: number; h: number }) =>
  rect[0] <= r.x && rect[1] <= r.y && rect[2] >= r.x + r.w && rect[3] >= r.y + r.h

// ---------- testes ----------

describe('renderizarPdf — comodato', () => {
  const dados = montarDadosProposta({
    modelo: 'comodato', itens: ITENS_REF, valorFinal: 0, mensalFinal: 690, entradaFinal: 2990, prazoMeses: 24,
  })

  it('1 página 16:9 de 960×540 com título, prazo, equipamentos, entrada e mensalidade', async () => {
    const pdf = await inspecionar(await gerarPropostaPdf(dados, loader({ totem: THUMB })))
    expect(pdf.paginas).toBe(1)
    expect(pdf.largura).toBe(PAGINA.largura)
    expect(pdf.altura).toBe(PAGINA.altura)
    expect(pdf.texto).toContain('MODELO COMODATO — IMPLANTAÇÃO RFID')
    expect(pdf.texto).toContain('IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID')
    expect(pdf.texto).toContain('— CONTRATO DE 24 MESES')
    expect(pdf.texto).toContain('02\n')
    expect(pdf.texto).toContain('Impressoras RFID')
    expect(pdf.texto).toContain('04\n')
    expect(pdf.texto).toContain('Totens RFID integrados')
    expect(pdf.texto).toContain('Leitura automatizada de entradas')
    expect(pdf.texto).toContain('01\n')
    expect(pdf.texto).toContain('Coletor RFID')
    expect(pdf.texto).toContain('entrada de')
    expect(pdf.texto).toContain('R$ 2.990,00')
    expect(pdf.texto).toContain('+ R$ 690,00/mês')
    expect(pdf.texto).not.toContain('INVESTIMENTO')
  })

  it('CTA: botão e URL visual viram links reais para PROPOSTA_APRESENTACAO_URL', async () => {
    const pdf = await inspecionar(await gerarPropostaPdf(dados, loader()))
    expect(pdf.links).toHaveLength(2)
    for (const l of pdf.links) {
      expect(l.uri).toBe(PROPOSTA_APRESENTACAO_URL)
      expect(l.rect[0]).toBeGreaterThanOrEqual(0)
      expect(l.rect[1]).toBeGreaterThanOrEqual(0)
      expect(l.rect[2]).toBeLessThanOrEqual(PAGINA.largura)
      expect(l.rect[3]).toBeLessThanOrEqual(PAGINA.altura)
    }
    expect(dentro(pdf.links[0].rect, caixa(LAYOUT.ctaBotao))).toBe(true)
    expect(dentro(pdf.links[1].rect, caixa(LAYOUT.ctaUrl))).toBe(true)
  })
})

describe('renderizarPdf — compra', () => {
  const itens: ItemProposta[] = [{ produto: 'coletor', qtd: 2 }, { produto: 'impressora', qtd: 1 }]
  const tabela = calcularCompra(itens).valorTabela // 25000
  const dados = montarDadosProposta({ modelo: 'compra', itens, valorFinal: 21000, mensalFinal: 0, entradaFinal: 0, prazoMeses: 24 })

  it('título de compra, subheader sem contrato, equipamentos e investimento negociado', async () => {
    const pdf = await inspecionar(await gerarPropostaPdf(dados, loader()))
    expect(pdf.paginas).toBe(1)
    expect(pdf.texto).toContain('MODELO COMPRA — IMPLANTAÇÃO RFID')
    expect(pdf.texto).toContain('IDEAL PARA INICIAR SUA AUTOMAÇÃO COM RFID')
    expect(pdf.texto).not.toMatch(/CONTRATO|MESES/)
    expect(pdf.texto).toContain('Coletores RFID')
    expect(pdf.texto).toContain('Impressora RFID')
    expect(pdf.texto).toContain('INVESTIMENTO')
    expect(pdf.texto).toContain('R$ 21.000,00')
    expect(pdf.texto).not.toContain('entrada de')
    expect(pdf.texto).not.toContain('/mês')
  })

  it('não vaza preço de tabela, referência nem desconto', async () => {
    const pdf = await inspecionar(await gerarPropostaPdf(dados, loader()))
    expect(pdf.texto).not.toContain('25.000')
    expect(pdf.texto).not.toContain(String(tabela))
    expect(pdf.texto).not.toMatch(/%|tabela|desconto/i)
  })

  it('CTA presente também na compra', async () => {
    const pdf = await inspecionar(await gerarPropostaPdf(dados, loader()))
    expect(pdf.links.map((l) => l.uri)).toEqual([PROPOSTA_APRESENTACAO_URL, PROPOSTA_APRESENTACAO_URL])
  })
})

describe('renderizarPdf — robustez', () => {
  const dados = montarDadosProposta({ modelo: 'comodato', itens: ITENS_REF, valorFinal: 0, mensalFinal: 690, entradaFinal: 2990, prazoMeses: 24 })

  it('thumbnail ausente ou inválido nunca impede a geração', async () => {
    const semThumbs = await inspecionar(await gerarPropostaPdf(dados, loader({})))
    expect(semThumbs.paginas).toBe(1)
    const invalido = await inspecionar(await gerarPropostaPdf(dados, loader({ totem: new Uint8Array([1, 2, 3]), impressora: THUMB })))
    expect(invalido.paginas).toBe(1)
    expect(invalido.texto).toContain('Totens RFID integrados')
  })

  it('imagem-base ausente é erro explícito (não gera PDF em branco)', async () => {
    await expect(gerarPropostaPdf(dados, async () => null)).rejects.toThrow(/Imagem-base/)
  })

  it(`acima de ${PROPOSTA_LIMITE_ITENS} tipos de equipamento recusa em vez de estourar a página`, async () => {
    const seis = montarDadosProposta({
      modelo: 'compra', valorFinal: 1, mensalFinal: 0, entradaFinal: 0, prazoMeses: 24,
      itens: ['coletor', 'impressora', 'totem', 'pdv', 'mesa_rfid', 'extra'].map((p) => ({ produto: p as ItemProposta['produto'], qtd: 1 })),
    })
    await expect(gerarPropostaPdf(seis, loader())).rejects.toThrow(/limite/)
  })

  it(`com ${PROPOSTA_LIMITE_ITENS} tipos ainda cabe em 1 página e mantém todos os nomes`, async () => {
    const cinco = montarDadosProposta({
      modelo: 'comodato', valorFinal: 0, mensalFinal: 1500, entradaFinal: 7500, prazoMeses: 24,
      itens: ['coletor', 'impressora', 'totem', 'pdv', 'mesa_rfid'].map((p) => ({ produto: p as ItemProposta['produto'], qtd: 1 })),
    })
    const pdf = await inspecionar(await gerarPropostaPdf(cinco, loader()))
    expect(pdf.paginas).toBe(1)
    for (const nome of ['Impressora RFID', 'Totem RFID integrado', 'Coletor RFID', 'PDV', 'Mesa de conferência RFID']) {
      expect(pdf.texto).toContain(nome)
    }
  })
})
