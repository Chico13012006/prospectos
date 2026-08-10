// Lista de tarefas da organização (Fase 4.4). Auth por sessão + escopo de org.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  const status = new URL(req.url).searchParams.get('status')
  let q = admin
    .from('tarefas')
    .select('id, titulo, tipo, status, prioridade, prazo_em, origem, motivo, lead_id, empresa_id, criado_em, empresas(nome)')
    .eq('organizacao_id', org)
    .order('criado_em', { ascending: false })
    .limit(200)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
  return NextResponse.json({ tarefas: data ?? [] })
}
