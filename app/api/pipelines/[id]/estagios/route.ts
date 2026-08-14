// PUT /api/pipelines/[id]/estagios — substitui os estágios de um pipeline.
// Requer workspace.configure. Não deleta dados: estágios removidos ficam ativo=false.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'

export const runtime = 'nodejs'

const PAPEIS_VALIDOS = new Set(['inicial', 'normal', 'ganho', 'perdido'])

interface EstagioInput {
  id?: string
  chave: string
  nome: string
  ordem: number
  cor?: string | null
  papel: string
  ativo?: boolean
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: pipelineId } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('workspace.configure')) {
    return NextResponse.json({ erro: 'Sem permissão (workspace.configure)' }, { status: 403 })
  }
  const { admin, org } = acc.acesso

  // Confirma que o pipeline pertence à org
  const { data: pipeline } = await admin
    .from('pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('organizacao_id', org)
    .maybeSingle()
  if (!pipeline) return NextResponse.json({ erro: 'Pipeline não encontrado' }, { status: 404 })

  const b = await req.json()
  const estagios: EstagioInput[] = Array.isArray(b.estagios) ? b.estagios : []

  // Validações básicas
  if (estagios.length === 0) return NextResponse.json({ erro: 'Ao menos um estágio é necessário' }, { status: 400 })
  for (const e of estagios) {
    if (!e.chave?.trim()) return NextResponse.json({ erro: 'Estágio sem chave' }, { status: 400 })
    if (!e.nome?.trim()) return NextResponse.json({ erro: `Estágio "${e.chave}" sem nome` }, { status: 400 })
    if (!PAPEIS_VALIDOS.has(e.papel)) return NextResponse.json({ erro: `Papel inválido: ${e.papel}` }, { status: 400 })
  }
  const iniciais = estagios.filter((e) => e.papel === 'inicial')
  if (iniciais.length > 1) return NextResponse.json({ erro: 'Apenas um estágio pode ter papel "inicial"' }, { status: 400 })

  // IDs existentes no pipeline
  const { data: existentes } = await admin
    .from('pipeline_estagios')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .eq('organizacao_id', org)
  const idsExistentes = new Set((existentes ?? []).map((e: { id: string }) => e.id))
  const idsEnviados = new Set(estagios.filter((e) => e.id).map((e) => e.id!))

  // Soft-delete dos removidos
  const idsRemovidos = [...idsExistentes].filter((id) => !idsEnviados.has(id))
  if (idsRemovidos.length > 0) {
    await admin.from('pipeline_estagios').update({ ativo: false }).in('id', idsRemovidos).eq('organizacao_id', org)
  }

  // Upsert de cada estágio
  for (const e of estagios) {
    const row = {
      organizacao_id: org,
      pipeline_id: pipelineId,
      chave: e.chave.trim(),
      nome: e.nome.trim(),
      ordem: e.ordem,
      cor: e.cor ?? null,
      papel: e.papel,
      ativo: e.ativo !== false,
    }
    if (e.id && idsExistentes.has(e.id)) {
      await admin.from('pipeline_estagios').update(row).eq('id', e.id).eq('organizacao_id', org)
    } else {
      await admin.from('pipeline_estagios').insert(row)
    }
  }

  // Retorna pipeline atualizado
  const { data: novos } = await admin
    .from('pipeline_estagios')
    .select('id, chave, nome, ordem, cor, papel, ativo')
    .eq('pipeline_id', pipelineId)
    .eq('organizacao_id', org)
    .eq('ativo', true)
    .order('ordem')

  return NextResponse.json({ ok: true, estagios: novos ?? [] })
}
