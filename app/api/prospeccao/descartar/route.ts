// Descarta CNPJs da busca da organização (não voltam a aparecer). Idempotente
// por (organizacao_id, cnpj). Grava organizacao_id da SESSÃO.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

const MAX = 200

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { cnpjs?: unknown; motivo?: unknown }
  const cnpjs = Array.isArray(corpo.cnpjs)
    ? [...new Set(corpo.cnpjs.filter((c): c is string => typeof c === 'string').map((c) => c.replace(/\D/g, '')))]
    : []
  if (cnpjs.length === 0 || cnpjs.length > MAX || cnpjs.some((c) => !/^\d{14}$/.test(c))) {
    return NextResponse.json({ erro: `Envie de 1 a ${MAX} CNPJs válidos.` }, { status: 400 })
  }
  const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 200) || null : null

  const { error } = await admin
    .from('prospeccao_descartes')
    .upsert(
      cnpjs.map((cnpj) => ({ organizacao_id: org, cnpj, motivo, descartado_por: user.id })),
      { onConflict: 'organizacao_id,cnpj', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[prospeccao/descartar] erro:', error)
    return NextResponse.json({ erro: 'Não foi possível descartar agora.' }, { status: 500 })
  }
  return NextResponse.json({ descartados: cnpjs.length })
}
