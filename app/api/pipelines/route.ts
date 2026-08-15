// Pipelines + estágios da organização. Tabelas reais da migration 0014.
// Org-scoped. Usado pela tela Configurações > Processo comercial.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const { data: pipelines } = await admin
    .from('pipelines').select('id, nome, tipo, ativo, ordem').eq('organizacao_id', org).order('ordem')
  const { data: estagios } = await admin
    .from('pipeline_estagios').select('id, pipeline_id, chave, nome, ordem, cor, papel, ativo')
    .eq('organizacao_id', org).eq('ativo', true).order('ordem')
  return NextResponse.json({
    pipelines: (pipelines ?? []).map((p) => ({ ...p, estagios: (estagios ?? []).filter((e) => e.pipeline_id === p.id) })),
  })
}

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('workspace.configure')) {
    return NextResponse.json({ erro: 'Sem permissão (workspace.configure)' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  const body = await req.json().catch(() => ({}))
  const nome = (body.nome as string)?.trim() || 'Pipeline padrão'
  const tipo = (body.tipo as string)?.trim() || 'prospeccao'

  const { data: pipeline, error } = await admin
    .from('pipelines')
    .insert({ organizacao_id: org, nome, tipo, ordem: 0 })
    .select('id')
    .single()

  if (error || !pipeline) {
    return NextResponse.json({ erro: 'Erro ao criar pipeline' }, { status: 500 })
  }

  // Estágios genéricos — sem nomenclatura de nicho
  await admin.from('pipeline_estagios').insert([
    { organizacao_id: org, pipeline_id: pipeline.id, chave: 'novo',         nome: 'Novo',         ordem: 0, cor: '#64748b', papel: 'inicial' },
    { organizacao_id: org, pipeline_id: pipeline.id, chave: 'em_andamento', nome: 'Em andamento', ordem: 1, cor: '#6366f1', papel: 'normal'  },
    { organizacao_id: org, pipeline_id: pipeline.id, chave: 'concluido',    nome: 'Concluído',    ordem: 2, cor: '#22c55e', papel: 'ganho'   },
  ])

  const { data: novosEstagios } = await admin
    .from('pipeline_estagios')
    .select('id, chave, nome, ordem, cor, papel, ativo')
    .eq('pipeline_id', pipeline.id)
    .eq('organizacao_id', org)
    .order('ordem')

  return NextResponse.json(
    { ok: true, pipeline: { id: pipeline.id, nome, tipo, ativo: true, ordem: 0, estagios: novosEstagios ?? [] } },
    { status: 201 },
  )
}
