// Início REAL da campanha pelo wizard. Publica a versão em dry-run, recalcula
// o público confirmado e cria as execuções; o cron existente processa os
// envios depois. Nenhum e-mail é disparado dentro desta requisição.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { iniciarCampanhaReal } from '@/lib/campanhas/ativacaoServidor'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro

  try {
    const body = await req.json().catch(() => ({}))
    const resultado = await iniciarCampanhaReal(
      acc.acesso.admin,
      acc.acesso.org,
      id,
      acc.acesso.user.id,
      typeof body.confirmarQuantidade === 'number' ? body.confirmarQuantidade : undefined,
    )
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
