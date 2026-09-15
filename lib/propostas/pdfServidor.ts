import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gerarPropostaPdf } from '@/lib/proposta/renderizarPdf'
import type { PropostaPdfData } from '@/lib/proposta/dados'

// PDF da proposta gerado NO SERVIDOR (envio ao cliente). É o mesmo
// renderizador do botão "Gerar proposta"; só muda a origem dos assets: disco
// em vez de fetch. Na Vercel, public/ não entra no bundle da função por padrão —
// o next.config.ts inclui public/proposta/** no trace das rotas /api/propostas.

const RAIZ_PUBLIC = path.join(process.cwd(), 'public')

// Caminho no formato de public/ ("/proposta/base-proposta.png"). Nunca sai de
// public/: o caminho é normalizado como absoluto antes de juntar. Arquivo
// ausente → null (o renderizador decide se isso é erro ou só "sem thumbnail").
export async function carregarAssetPublicoDoDisco(caminho: string): Promise<Uint8Array | null> {
  const relativo = path.posix.normalize(`/${caminho}`).slice(1)
  const destino = path.resolve(RAIZ_PUBLIC, relativo)
  if (!destino.startsWith(RAIZ_PUBLIC + path.sep)) return null
  try {
    return new Uint8Array(await readFile(destino))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export function gerarPdfPropostaServidor(dados: PropostaPdfData): Promise<Uint8Array> {
  return gerarPropostaPdf(dados, carregarAssetPublicoDoDisco)
}
