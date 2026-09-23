// Fonte real: share WebDAV público dos dados abertos do CNPJ na Receita
// Federal. Baixa cada zip em streaming e descompacta sem tocar o disco.
// Só para scripts Node — não importar em rota da Vercel (arquivos de GB).

import zlib from 'node:zlib'
import { Readable, Transform } from 'node:stream'
import type { FonteRf } from './carga'

const RF_BASE = 'https://arquivos.receitafederal.gov.br/public.php/webdav'
// Token do share público oficial da RF (não é segredo: é o link público).
const RF_SHARE_PADRAO = 'YggdBLfdninEJX9'

function autorizacao(): string {
  const token = process.env.PROSPECCAO_RF_SHARE || RF_SHARE_PADRAO
  return 'Basic ' + Buffer.from(`${token}:`).toString('base64')
}

export async function mesMaisRecenteRf(): Promise<string> {
  const res = await fetch(`${RF_BASE}/`, {
    method: 'PROPFIND',
    headers: { Authorization: autorizacao(), Depth: '1' },
  })
  if (!res.ok) throw new Error(`PROPFIND na RF falhou: HTTP ${res.status}`)
  const xml = await res.text()
  const meses = [...xml.matchAll(/webdav\/(\d{4}-\d{2})/g)].map((m) => m[1])
  if (meses.length === 0) throw new Error('Nenhuma pasta de mês encontrada no share da RF')
  return meses.sort().at(-1)!
}

// Remove o local file header do zip e repassa o deflate cru. Os zips da RF
// têm UMA entrada, então basta pular o cabeçalho; o central directory no fim
// é ignorado pelo inflate depois do fim do stream deflate.
function criarStripZipHeader(): Transform {
  let cabecalho: Buffer = Buffer.alloc(0)
  let pularRestante = -1 // -1 = ainda lendo o cabeçalho fixo
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (pularRestante === -1) {
        cabecalho = Buffer.concat([cabecalho, chunk])
        if (cabecalho.length < 30) return cb()
        if (cabecalho.readUInt32LE(0) !== 0x04034b50) {
          return cb(new Error('Arquivo baixado não é um zip (assinatura inválida)'))
        }
        if (cabecalho.readUInt16LE(8) !== 8) {
          return cb(new Error('Zip da RF não usa deflate — layout do arquivo mudou'))
        }
        pularRestante = 30 + cabecalho.readUInt16LE(26) + cabecalho.readUInt16LE(28)
        chunk = cabecalho
        cabecalho = Buffer.alloc(0)
      }
      if (pularRestante > 0) {
        const corta = Math.min(pularRestante, chunk.length)
        pularRestante -= corta
        chunk = chunk.subarray(corta)
      }
      if (chunk.length > 0) this.push(chunk)
      cb()
    },
  })
}

const INTERVALO_PROGRESSO_MS = 30_000

export function criarFonteRf(mesRf: string, opcoes: { aoProgredir?: (msg: string) => void } = {}): FonteRf {
  return {
    async *linhas(arquivo: string) {
      const url = `${RF_BASE}/${mesRf}/${arquivo}`
      const res = await fetch(url, { headers: { Authorization: autorizacao() } })
      if (!res.ok || !res.body) throw new Error(`Download da RF falhou (${arquivo}): HTTP ${res.status}`)

      // Os arquivos têm centenas de MB: sem progresso dentro do arquivo não dá
      // para distinguir download lento de processo travado.
      const total = Number(res.headers.get('content-length') || 0)
      let bytes = 0
      const contador = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          bytes += chunk.length
          cb(null, chunk)
        },
      })
      const timer = opcoes.aoProgredir
        ? setInterval(() => {
            const mb = (bytes / 1048576).toFixed(0)
            const pct = total ? ` (${((bytes / total) * 100).toFixed(1)}%)` : ''
            opcoes.aoProgredir!(`${arquivo}: ${mb} MB${pct}`)
          }, INTERVALO_PROGRESSO_MS)
        : null

      const fonte = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      fonte.on('error', (e) => contador.destroy(e))
      try {
        yield* linhasDeZip(fonte.pipe(contador))
      } finally {
        if (timer) clearInterval(timer)
        fonte.destroy()
      }
    },
  }
}

/** Linhas (latin1) da única entrada de um zip recebido em stream. */
export async function* linhasDeZip(fonte: Readable): AsyncGenerator<string> {
  const strip = criarStripZipHeader()
  const inflate = zlib.createInflateRaw()
  inflate.setEncoding('latin1')

  // Erro em qualquer elo precisa chegar ao consumidor: um download truncado
  // não pode terminar "normalmente" e virar catálogo incompleto. A iteração
  // do inflate rejeita quando ele é destruído com erro (inclusive o
  // "unexpected end of file" de um deflate cortado).
  const repassar = (e: Error) => inflate.destroy(e)
  fonte.on('error', repassar)
  strip.on('error', repassar)
  fonte.pipe(strip).pipe(inflate)

  try {
    yield* dividirLinhas(inflate)
  } finally {
    fonte.destroy()
  }
}

export async function* dividirLinhas(texto: AsyncIterable<string>): AsyncGenerator<string> {
  let resto = ''
  for await (const pedaco of texto) {
    const partes = (resto + pedaco).split('\n')
    resto = partes.pop() ?? ''
    for (const p of partes) yield p.endsWith('\r') ? p.slice(0, -1) : p
  }
  if (resto) yield resto.endsWith('\r') ? resto.slice(0, -1) : resto
}
