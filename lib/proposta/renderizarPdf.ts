// Renderização da proposta comercial em PDF (pdf-lib).
//
// Recebe SOMENTE `PropostaPdfData` já normalizado — nunca calcula preço nem
// importa lib/simulador. Página única 16:9 de 960×540 pt: a imagem-base
// (identidade, blocos fixos, footer, CTA visual) é desenhada ocupando a página
// inteira e só o conteúdo dinâmico é escrito por cima — título, subheader,
// lista de equipamentos (com thumbnail opcional), bloco financeiro e as
// anotações de link do CTA. As regiões ficam todas em `LAYOUT`, medidas em
// PIXELS DA GRADE 1920×1080 (origem no canto superior esquerdo, como num
// editor de imagem); `caixa()` escala para pontos e inverte o eixo Y do PDF.
// Roda em browser (fetch) e em Node (fs) porque os assets chegam por
// `carregarAsset`.

import {
  PDFDocument, PDFString, StandardFonts, rgb,
  type PDFFont, type PDFImage, type PDFPage, type PDFRef, type RGB,
} from 'pdf-lib'
import {
  PROPOSTA_APRESENTACAO_URL, PROPOSTA_BASE_IMAGEM, PROPOSTA_LIMITE_ITENS, PROPOSTA_THUMBNAILS_DIR,
} from './config'
import { formatarBRLCentavos, formatarQtd, type PropostaPdfData } from './dados'

export const PAGINA = { largura: 960, altura: 540 } as const

// Grade em que as regiões são medidas. Trocar a resolução do PNG não exige
// remedir: a imagem é sempre esticada para a página inteira.
const GRADE = { largura: 1920, altura: 1080 } as const
const ESCALA = PAGINA.largura / GRADE.largura

export interface Regiao { x: number; y: number; w: number; h: number }

// Única fonte de coordenadas (px da grade 1920×1080), medidas sobre a arte
// aprovada. Ajuste fino visual = editar números aqui, nunca no código abaixo.
export const LAYOUT = {
  // Faixa vinho do header: texto branco alinhado à esquerda.
  titulo: { x: 192, y: 60, w: 1290, h: 80 },
  // Linha abaixo do header: parte em negrito + parte regular.
  subtitulo: { x: 201, y: 184, w: 1520, h: 50 },
  // Conteúdo do card "Solução proposta" (abaixo do título fixo do card). Cada
  // linha tem a altura do seu conteúdo (thumbnail na largura da coluna ou
  // bloco de texto), entre linhaMin e alturaLinhaMax; se a soma passar de h,
  // todas encolhem na mesma proporção.
  equipamentos: {
    x: 120, y: 340, w: 730, h: 385,
    linhaMin: 56, alturaLinhaMax: 180, padLinha: 2, gapDescricao: 4,
    thumb: { x: 140, w: 160, alturaMax: 172 },
    qtd: { x: 362 },
    vezes: { x: 442 },
    nome: { x: 488, w: 350 },
  },
  // Bloco financeiro centralizado entre as linhas decorativas da arte.
  financeiro: {
    rotulo: { x: 560, y: 772, w: 800, h: 32 },
    valor: { x: 560, y: 802, w: 800, h: 56 },
    mensal: { x: 560, y: 862, w: 800, h: 40 },
  },
  // Áreas clicáveis sobre o botão e a URL desenhados na imagem-base.
  ctaBotao: { x: 1215, y: 926, w: 445, h: 88 },
  ctaUrl: { x: 1215, y: 1004, w: 400, h: 44 },
} as const

const COR = {
  branco: rgb(1, 1, 1),
  texto: rgb(0.14, 0.14, 0.16),
  textoSuave: rgb(0.45, 0.45, 0.48),
  cinzaRotulo: rgb(0.3, 0.3, 0.32),
  vinho: rgb(123 / 255, 12 / 255, 40 / 255),
  verde: rgb(0, 154 / 255, 81 / 255),
  separador: rgb(0.86, 0.86, 0.87),
} as const

// Tamanhos base em pt; a lista de equipamentos reduz discretamente conforme o
// número de linhas para nunca estourar a região.
const FONTE = { titulo: 30, subtitulo: 17.5, nome: 16, vezes: 13, descricao: 9.5, rotulo: 17, valor: 32, mensal: 19 } as const

// Loader de assets de public/: `null` quando o arquivo não existe. Thumbnail
// ausente nunca derruba a geração; imagem-base ausente é erro explícito.
export type CarregarAsset = (caminho: string) => Promise<Uint8Array | null>

export async function gerarPropostaPdf(
  dados: PropostaPdfData,
  carregarAsset: CarregarAsset,
): Promise<Uint8Array> {
  if (dados.equipamentos.length > PROPOSTA_LIMITE_ITENS) {
    throw new Error(`Proposta com ${dados.equipamentos.length} tipos de equipamento excede o limite de ${PROPOSTA_LIMITE_ITENS} por página.`)
  }
  const base = await carregarAsset(PROPOSTA_BASE_IMAGEM)
  if (!base) throw new Error(`Imagem-base da proposta não encontrada em ${PROPOSTA_BASE_IMAGEM}.`)

  const doc = await PDFDocument.create()
  doc.setTitle('Proposta comercial — InovaCode')
  doc.setProducer('ProspectOS')
  const page = doc.addPage([PAGINA.largura, PAGINA.altura])
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const imgBase = await embutirImagem(doc, base)
  page.drawImage(imgBase, { x: 0, y: 0, width: PAGINA.largura, height: PAGINA.altura })

  // Header + subheader.
  escrever(page, [{ texto: dados.titulo, font: bold, color: COR.branco }], LAYOUT.titulo, FONTE.titulo)
  escrever(page, runsSubtitulo(dados.subtitulo, bold, regular), LAYOUT.subtitulo, FONTE.subtitulo)

  await desenharEquipamentos(doc, page, dados, carregarAsset, { regular, bold })
  desenharFinanceiro(page, dados, { regular, bold })

  // CTA: o botão e a URL já estão na imagem-base; aqui só entram as anotações
  // de link (invisíveis) cobrindo as duas áreas.
  page.node.addAnnot(anotacaoLink(doc, LAYOUT.ctaBotao, PROPOSTA_APRESENTACAO_URL))
  page.node.addAnnot(anotacaoLink(doc, LAYOUT.ctaUrl, PROPOSTA_APRESENTACAO_URL))

  return doc.save()
}

// "IDEAL PARA … RFID" em negrito; " — CONTRATO DE N MESES" (se houver) regular.
function runsSubtitulo(subtitulo: string, bold: PDFFont, regular: PDFFont): Run[] {
  const corte = subtitulo.indexOf(' — ')
  if (corte < 0) return [{ texto: subtitulo, font: bold, color: COR.texto }]
  return [
    { texto: subtitulo.slice(0, corte), font: bold, color: COR.texto },
    { texto: subtitulo.slice(corte), font: regular, color: COR.texto, gapAntes: 3 },
  ]
}

async function desenharEquipamentos(
  doc: PDFDocument,
  page: PDFPage,
  dados: PropostaPdfData,
  carregarAsset: CarregarAsset,
  f: { regular: PDFFont; bold: PDFFont },
) {
  const R = LAYOUT.equipamentos
  const n = dados.equipamentos.length
  if (n === 0) return
  const fator = n <= 3 ? 1 : n === 4 ? 0.9 : 0.8
  const tamNome = FONTE.nome * fator
  const tamDesc = FONTE.descricao * fator
  const tamVezes = FONTE.vezes * fator
  const linhaNome = ptParaGrade(tamNome * 1.2)
  const linhaDesc = ptParaGrade(tamDesc * 1.25)

  // 1) Mede cada linha pelo conteúdo: thumbnail ajustado à largura da coluna
  //    (reduzido junto com a tipografia) ou bloco nome + descrição.
  const linhas = []
  for (const eq of dados.equipamentos) {
    const thumb = await carregarThumbnail(doc, carregarAsset, eq.produto)
    const descLinhas = eq.descricao ? quebrar(eq.descricao, f.regular, tamDesc, R.nome.w) : []
    const alturaTexto = linhaNome + (descLinhas.length ? R.gapDescricao + descLinhas.length * linhaDesc : 0)
    const alturaThumb = thumb ? Math.min(R.thumb.w * (thumb.height / thumb.width), R.thumb.alturaMax) * fator : 0
    const natural = Math.max(alturaTexto, alturaThumb, R.linhaMin) + 2 * R.padLinha
    linhas.push({ eq, thumb, descLinhas, alturaTexto, altura: Math.min(natural, R.alturaLinhaMax) })
  }
  // 2) Nunca estoura a região: se a soma passar, encolhe todas na mesma proporção.
  const soma = linhas.reduce((s, l) => s + l.altura, 0)
  const escala = Math.min(1, R.h / soma)

  let topo = R.y
  linhas.forEach((l, i) => {
    const altura = l.altura * escala
    if (i > 0) desenharLinha(page, R.x, topo, R.w, COR.separador)
    if (l.thumb) desenharContida(page, l.thumb, { x: R.thumb.x, y: topo + R.padLinha, w: R.thumb.w, h: altura - 2 * R.padLinha })

    const topoBloco = topo + (altura - l.alturaTexto) / 2
    textoTopo(page, formatarQtd(l.eq.qtd), R.qtd.x, topoBloco, f.bold, tamNome, COR.vinho)
    textoTopo(page, '×', R.vezes.x, topoBloco + ptParaGrade((tamNome - tamVezes) * 0.5), f.regular, tamVezes, COR.cinzaRotulo)
    textoTopo(page, l.eq.nome, R.nome.x, topoBloco, f.regular, tamNome, COR.texto)
    l.descLinhas.forEach((texto, k) => {
      textoTopo(page, texto, R.nome.x, topoBloco + linhaNome + R.gapDescricao + k * linhaDesc, f.regular, tamDesc, COR.textoSuave)
    })
    topo += altura
  })
}

function desenharFinanceiro(page: PDFPage, dados: PropostaPdfData, f: { regular: PDFFont; bold: PDFFont }) {
  const F = LAYOUT.financeiro
  const fin = dados.financeiro
  if (fin.tipo === 'compra') {
    escrever(page, [{ texto: 'INVESTIMENTO', font: f.bold, color: COR.cinzaRotulo }], F.rotulo, FONTE.rotulo, 'centro')
    escrever(page, [{ texto: formatarBRLCentavos(fin.investimento), font: f.bold, color: COR.verde }], F.valor, FONTE.valor, 'centro')
    return
  }
  escrever(page, [{ texto: 'entrada de', font: f.regular, color: COR.cinzaRotulo }], F.rotulo, FONTE.rotulo, 'centro')
  escrever(page, [{ texto: formatarBRLCentavos(fin.entrada), font: f.bold, color: COR.verde }], F.valor, FONTE.valor, 'centro')
  escrever(page, [{ texto: `+ ${formatarBRLCentavos(fin.mensal)}/mês`, font: f.bold, color: COR.texto }], F.mensal, FONTE.mensal, 'centro')
}

// ---------- primitivas de desenho (todas recebem coordenadas da grade) ----------

interface Run { texto: string; font: PDFFont; color: RGB; gapAntes?: number } // gapAntes em pt

// px da grade (origem em cima à esquerda) → pt do PDF (origem embaixo à esquerda).
export function caixa(r: Regiao): { x: number; y: number; w: number; h: number } {
  return { x: r.x * ESCALA, y: PAGINA.altura - (r.y + r.h) * ESCALA, w: r.w * ESCALA, h: r.h * ESCALA }
}

const ptParaGrade = (pt: number) => pt / ESCALA

// Uma linha composta por trechos (fonte/cor próprias), centrada verticalmente
// na região pela altura de caixa-alta; alinhamento horizontal opcional.
function escrever(page: PDFPage, runs: Run[], r: Regiao, size: number, alinhar: 'esquerda' | 'centro' | 'direita' = 'esquerda') {
  const c = caixa(r)
  const larguraTotal = runs.reduce((s, run) => s + (run.gapAntes ?? 0) + run.font.widthOfTextAtSize(run.texto, size), 0)
  let x = alinhar === 'centro' ? c.x + (c.w - larguraTotal) / 2 : alinhar === 'direita' ? c.x + c.w - larguraTotal : c.x
  const y = c.y + (c.h - size * 0.72) / 2 // 0.72 = cap height da Helvetica
  for (const run of runs) {
    x += run.gapAntes ?? 0
    page.drawText(run.texto, { x, y, size, font: run.font, color: run.color })
    x += run.font.widthOfTextAtSize(run.texto, size)
  }
}

// Texto ancorado pelo TOPO da linha (grade): baseline = topo − ascendente
// (0.95 em cobre acentos de caixa-alta).
function textoTopo(page: PDFPage, texto: string, xGrade: number, topoGrade: number, font: PDFFont, size: number, color: RGB) {
  page.drawText(texto, { x: xGrade * ESCALA, y: PAGINA.altura - topoGrade * ESCALA - size * 0.95, size, font, color })
}

function desenharLinha(page: PDFPage, xGrade: number, yGrade: number, wGrade: number, color: RGB) {
  page.drawRectangle({ x: xGrade * ESCALA, y: PAGINA.altura - yGrade * ESCALA, width: wGrade * ESCALA, height: 0.6, color })
}

// Imagem ajustada dentro da caixa (contain), centrada.
function desenharContida(page: PDFPage, img: PDFImage, r: Regiao) {
  const c = caixa(r)
  const s = Math.min(c.w / img.width, c.h / img.height)
  const w = img.width * s, h = img.height * s
  page.drawImage(img, { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, width: w, height: h })
}

// Quebra por palavras pela largura real da fonte.
function quebrar(texto: string, font: PDFFont, size: number, larguraGrade: number): string[] {
  const max = larguraGrade * ESCALA
  const linhas: string[] = []
  let atual = ''
  for (const palavra of texto.split(' ')) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra
    if (!atual || font.widthOfTextAtSize(tentativa, size) <= max) atual = tentativa
    else { linhas.push(atual); atual = palavra }
  }
  if (atual) linhas.push(atual)
  return linhas
}

async function embutirImagem(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const ehPng = bytes[0] === 0x89 && bytes[1] === 0x50
  return ehPng ? doc.embedPng(bytes) : doc.embedJpg(bytes)
}

// Thumbnail opcional por produto; qualquer falha (404, PNG inválido) vira
// "sem thumbnail" — a proposta nunca deixa de ser gerada por isso.
const cacheThumbs = new WeakMap<PDFDocument, Map<string, PDFImage | null>>()
async function carregarThumbnail(doc: PDFDocument, carregarAsset: CarregarAsset, produto: string): Promise<PDFImage | null> {
  let cache = cacheThumbs.get(doc)
  if (!cache) { cache = new Map(); cacheThumbs.set(doc, cache) }
  if (cache.has(produto)) return cache.get(produto)!
  let img: PDFImage | null = null
  try {
    const bytes = await carregarAsset(`${PROPOSTA_THUMBNAILS_DIR}/${produto}.png`)
    if (bytes) img = await embutirImagem(doc, bytes)
  } catch {
    img = null
  }
  cache.set(produto, img)
  return img
}

// Anotação /Link com ação URI e borda zerada: a área inteira vira clicável sem
// desenhar nada por cima do visual da imagem-base.
function anotacaoLink(doc: PDFDocument, r: Regiao, url: string): PDFRef {
  const c = caixa(r)
  return doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [c.x, c.y, c.x + c.w, c.y + c.h],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    }),
  )
}
