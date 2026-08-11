// Oportunidades (deals) da organização (Fase 5). GET lista, POST cria. Auth por
// sessão + escopo de org (mesmo modelo de /tarefas e /leads: sem permissão
// granular — o RBAC cobre campaigns/workflows/workspace/analytics).
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { listarOportunidades, criarOportunidade } from '@/lib/oportunidades/repository'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const status = new URL(req.url).searchParams.get('status') ?? undefined
  try {
    const oportunidades = await listarOportunidades(admin, org, { status })
    return NextResponse.json({ oportunidades })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  if (typeof b?.titulo !== 'string' || !b.titulo.trim()) {
    return NextResponse.json({ erro: 'Título é obrigatório' }, { status: 400 })
  }
  try {
    const nova = await criarOportunidade(admin, org, {
      titulo: b.titulo.trim(),
      valor: typeof b.valor === 'number' ? b.valor : null,
      probabilidade: typeof b.probabilidade === 'number' ? b.probabilidade : null,
      status: b.status,
      origem: typeof b.origem === 'string' ? b.origem : 'manual',
      responsavel_id: b.responsavel_id || null,
      previsao_fechamento: b.previsao_fechamento || null,
      lead_id: b.lead_id || null,
      empresa_id: b.empresa_id || null,
      contato_id: b.contato_id || null,
      servico_id: b.servico_id || null,
      pipeline_id: b.pipeline_id || null,
      estagio_id: b.estagio_id || null,
    })
    return NextResponse.json({ ok: true, id: nova.id })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
