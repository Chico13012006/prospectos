import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { ErroEdicaoLead, normalizarPatchCadastralLead } from '@/lib/leads/edicao'
import { atualizarDadosCadastraisLead, buscarLeadParaEdicao, emailPertenceAOutroLead } from '@/lib/leads/repository'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  try {
    const patch = normalizarPatchCadastralLead(await req.json())
    const atual = await buscarLeadParaEdicao(admin, org, id)
    if (!atual) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    if (
      patch.contato_email
      && patch.contato_email !== atual.contato_email?.trim().toLowerCase()
      && await emailPertenceAOutroLead(admin, org, id, patch.contato_email)
    ) {
      return NextResponse.json({ erro: 'Já existe outro lead com esse e-mail na sua base.' }, { status: 409 })
    }

    const lead = await atualizarDadosCadastraisLead(admin, org, id, patch)
    if (!lead) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })
    return NextResponse.json({ lead })
  } catch (erro) {
    if (erro instanceof ErroEdicaoLead) {
      return NextResponse.json({ erro: erro.message }, { status: 400 })
    }
    console.error('[leads PATCH] erro:', erro)
    return NextResponse.json({ erro: 'Não foi possível atualizar o lead.' }, { status: 500 })
  }
}
