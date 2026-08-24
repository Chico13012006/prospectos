// Edição restrita da agenda de uma campanha já publicada. Não reabre público,
// mensagens, templates nem workflow: a versão publicada e as execuções já
// inscritas permanecem intactas; só os próximos ciclos consultam os novos dias.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { atualizarCampanha, buscarCampanha } from '@/lib/campanhas/repository'
import { publicoComDiasAtualizados } from '@/lib/campanhas/agenda'
import { campanhaEhDisparoUnico } from '@/lib/campanhas/configuracaoGuiada'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    if (campanhaEhDisparoUnico(campanha.tipo)) {
      return NextResponse.json(
        { erro: 'Comunicações são disparos únicos e não possuem agenda recorrente.' },
        { status: 409 },
      )
    }
    if (campanha.status !== 'ativa' && campanha.status !== 'pausada') {
      return NextResponse.json(
        { erro: campanha.status === 'concluida' ? 'Campanha concluída é somente leitura.' : 'Edite a agenda do rascunho no assistente da campanha.' },
        { status: 409 },
      )
    }

    const body = await req.json()
    const publico = publicoComDiasAtualizados(campanha.publico, body?.diasSemana)
    await atualizarCampanha(admin, org, id, { publico })
    return NextResponse.json({ ok: true, agenda: publico.agenda })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Não foi possível atualizar a agenda.' }, { status: 400 })
  }
}
