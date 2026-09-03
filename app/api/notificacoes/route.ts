// Notificações da organização (Fase 4.4), mais recentes primeiro. Auth por
// sessão + escopo de org. In-app (canal app) e registro das de e-mail.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, role, user } = acc.acesso

  let consulta = admin
    .from('notificacoes')
    .select('id, titulo, mensagem, canal, origem, motivo, link, lida, criado_em')
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(50)
  // O client admin ignora RLS. Usuários comuns recebem só seus avisos; admins
  // mantêm a visão operacional de toda a organização.
  if (role !== 'admin') consulta = consulta.eq('perfil_id', user.id)

  const { data, error } = await consulta
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ notificacoes: data ?? [] })
}
