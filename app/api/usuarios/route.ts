// Usuários (SDRs) da organização — para selects de responsável (Fase 4.5).
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const { data, error } = await admin
    .from('usuarios').select('id, nome, email').eq('organizacao_id', org).eq('ativo', true).order('nome')
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ usuarios: data ?? [] })
}
