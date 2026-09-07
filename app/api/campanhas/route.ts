// Campanhas da organização (Fase 7). GET lista (campaigns.view), POST cria
// (campaigns.manage). Auth + RBAC granular (permissões da migration 0015).
import { NextResponse } from 'next/server'
import { resolverAcesso, exigirPermissao } from '@/lib/rbac/servidor'
import { listarCampanhas, criarCampanha } from '@/lib/campanhas/repository'
import { aplicarRegraPublicoPorTipo, normalizarPublicoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import { materializarCampanhaGuiada } from '@/lib/campanhas/materializarServidor'
import { buscarResumosExecucoesCampanhas } from '@/lib/campanhas/resumoExecucoesServidor'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  const status = new URL(req.url).searchParams.get('status') ?? undefined
  try {
    const campanhas = await listarCampanhas(admin, org, { status })
    const resumos = await buscarResumosExecucoesCampanhas(admin, org, campanhas.map((campanha) => campanha.id))
    return NextResponse.json({
      campanhas: campanhas.map((campanha) => ({ ...campanha, resumoExecucoes: resumos[campanha.id] })),
    })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

export async function POST(req: Request) {
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  if (typeof b?.nome !== 'string' || !b.nome.trim()) {
    return NextResponse.json({ erro: 'Nome é obrigatório' }, { status: 400 })
  }
  try {
    const tipo = typeof b.tipo === 'string' ? b.tipo : null
    const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(b.publico), tipo)
    const nova = await criarCampanha(admin, org, {
      nome: b.nome.trim(),
      descricao: typeof b.descricao === 'string' ? b.descricao : null,
      tipo,
      workflow_id: b.workflow_id || null,
      publico: publico as Record<string, unknown>,
      meta_leads: b.meta_leads == null || b.meta_leads === ''
        ? null
        : Number.isFinite(Number(b.meta_leads)) ? Number(b.meta_leads) : null,
    })
    const materializada = await materializarCampanhaGuiada(admin, org, nova.id, b.nome.trim(), publico)
    return NextResponse.json({ ok: true, id: nova.id, workflow_id: materializada.workflowId })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
