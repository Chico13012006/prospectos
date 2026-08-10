// Atualiza o status de uma tarefa (Fase 4.4). Auth por sessão + escopo de org.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

const STATUS_VALIDOS = ['aberta', 'em_andamento', 'concluida', 'cancelada']

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const { status } = await req.json()
  if (!STATUS_VALIDOS.includes(status)) {
    return NextResponse.json({ erro: 'Status inválido' }, { status: 400 })
  }
  const agora = new Date().toISOString()
  const patch: Record<string, unknown> = { status, atualizado_em: agora }
  patch.concluido_em = status === 'concluida' ? agora : null

  const { error } = await admin
    .from('tarefas').update(patch).eq('id', id).eq('organizacao_id', org)
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
