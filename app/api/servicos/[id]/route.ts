// Editar / arquivar um serviço recorrente (Fase 4.5). Auth por sessão + org.
// vencimento_em é recalculado pelo trigger quando realizado_em/periodicidade mudam.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const b = await req.json()
  const patch: Record<string, unknown> = {}
  if ('tipo' in b) patch.tipo = typeof b.tipo === 'string' && b.tipo.trim() ? b.tipo.trim() : null
  if ('realizado_em' in b) patch.realizado_em = b.realizado_em || null
  if ('periodicidade_valor' in b) patch.periodicidade_valor = Number.isFinite(b.periodicidade_valor) ? b.periodicidade_valor : null
  if ('periodicidade_unidade' in b) patch.periodicidade_unidade = ['dias', 'meses', 'anos'].includes(b.periodicidade_unidade) ? b.periodicidade_unidade : null
  if ('status' in b && ['vigente', 'vencido', 'renovado', 'cancelado'].includes(b.status)) patch.status = b.status
  if ('responsavel_id' in b) patch.responsavel_id = b.responsavel_id || null
  if ('observacoes' in b) patch.observacoes = typeof b.observacoes === 'string' ? b.observacoes : null
  if ('arquivado' in b) {
    patch.arquivado = !!b.arquivado
    patch.arquivado_em = b.arquivado ? new Date().toISOString() : null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ erro: 'Nada para atualizar' }, { status: 400 })

  const { error } = await admin.from('servicos_recorrentes').update(patch).eq('id', id).eq('organizacao_id', org)
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
