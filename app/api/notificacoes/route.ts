// Notificações da organização (Fase 4.4), mais recentes primeiro. Auth por
// sessão + escopo de org. In-app (canal app) e registro das de e-mail.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const { data, error } = await admin
    .from('notificacoes')
    .select('id, titulo, mensagem, canal, origem, motivo, link, lida, criado_em')
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ notificacoes: data ?? [] })
}
