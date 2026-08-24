// Lê / atualiza / transiciona uma campanha (Fase 7). GET requer campaigns.view;
// PATCH requer campaigns.manage.
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { atualizarCampanha, buscarCampanha } from '@/lib/campanhas/repository'
import { buscarContextoResumoOperacional } from '@/lib/campanhas/resumoOperacionalServidor'
import { materializarCampanhaGuiada } from '@/lib/campanhas/materializarServidor'
import { aplicarRegraPublicoPorTipo, normalizarPublicoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import { buscarPreviaPublicoCampanha, previaParaCliente } from '@/lib/campanhas/publicoServidor'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  const { admin, org } = acc.acesso
  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    const publicoBruto = campanha.publico && typeof campanha.publico === 'object'
      ? campanha.publico as Record<string, unknown>
      : {}
    const temSelecaoGuiada = publicoBruto.selecao && typeof publicoBruto.selecao === 'object'
    const [resumoOperacional, previaPublico] = await Promise.all([
      buscarContextoResumoOperacional(admin, org, campanha),
      temSelecaoGuiada
        ? buscarPreviaPublicoCampanha(
            admin,
            org,
            aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(campanha.publico), campanha.tipo),
            campanha.workflow_id,
          ).then(previaParaCliente)
        : Promise.resolve(null),
    ])
    return NextResponse.json({ campanha, resumoOperacional, previaPublico })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  const b = await req.json()
  try {
    const atual = await buscarCampanha(admin, org, id)
    if (!atual) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })

    if (b.publico && typeof b.publico === 'object') {
      if (atual.status !== 'rascunho') {
        return NextResponse.json(
          { erro: 'Campanha publicada não pode reabrir público ou mensagens. Use a edição restrita da agenda.' },
          { status: 409 },
        )
      }
      const tipo = typeof b.tipo === 'string' ? b.tipo : atual.tipo
      const publico = aplicarRegraPublicoPorTipo(normalizarPublicoCampanha(b.publico), tipo)
      const materializada = await materializarCampanhaGuiada(
        admin,
        org,
        id,
        typeof b.nome === 'string' && b.nome.trim() ? b.nome.trim() : atual.nome,
        publico,
      )
      const restante = { ...b }
      delete restante.publico
      delete restante.workflow_id
      if (Object.keys(restante).length) await atualizarCampanha(admin, org, id, restante)
      return NextResponse.json({ ok: true, workflow_id: materializada.workflowId ?? atual.workflow_id })
    }

    await atualizarCampanha(admin, org, id, b)
    return NextResponse.json({ ok: true, workflow_id: atual.workflow_id })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
