// Quadro societário de um CNPJ via OpenCNPJ, para o passo "analisar".
// Só consulta CNPJ presente no catálogo: a rota não é um proxy aberto.
import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { consultarSocios, sugerirDecisor } from '@/lib/prospeccao/socios'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin } = acc.acesso

  const cnpj = (req.nextUrl.searchParams.get('cnpj') ?? '').replace(/\D/g, '')
  if (!/^\d{14}$/.test(cnpj)) return NextResponse.json({ erro: 'CNPJ inválido.' }, { status: 400 })

  const { data, error } = await admin.from('catalogo_estabelecimentos').select('cnpj').eq('cnpj', cnpj).maybeSingle()
  if (error) return NextResponse.json({ erro: 'Não foi possível consultar agora.' }, { status: 500 })
  if (!data) return NextResponse.json({ erro: 'CNPJ fora do catálogo.' }, { status: 404 })

  const r = await consultarSocios(cnpj)
  if (!r.ok) {
    return NextResponse.json(
      { erro: r.motivo === 'nao_encontrado' ? 'OpenCNPJ não encontrou este CNPJ.' : 'OpenCNPJ indisponível no momento.' },
      { status: r.motivo === 'nao_encontrado' ? 404 : 502 },
    )
  }
  return NextResponse.json({ socios: r.socios, sugerido: sugerirDecisor(r.socios) })
}
