// Renomear (PATCH) e excluir (DELETE) uma pesquisa salva. Só age na lista da
// organização da sessão: id de outra org simplesmente não é encontrado (404).
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { removerPesquisa, renomearPesquisa } from '@/lib/prospeccao/pesquisas'
import { gravarPesquisas, lerConfig } from '@/lib/prospeccao/pesquisasServidor'

export const runtime = 'nodejs'

type Contexto = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Contexto) {
  const { id } = await params
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown }
    const config = await lerConfig(admin, org)
    const r = renomearPesquisa(config.prospeccaoPesquisas ?? [], id, corpo.nome)
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    return NextResponse.json({ pesquisas: await gravarPesquisas(admin, org, config, r.lista) })
  } catch (err) {
    console.error('[prospeccao/pesquisas PATCH] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível renomear a pesquisa.' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Contexto) {
  const { id } = await params
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const config = await lerConfig(admin, org)
    const r = removerPesquisa(config.prospeccaoPesquisas ?? [], id)
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    return NextResponse.json({ pesquisas: await gravarPesquisas(admin, org, config, r.lista) })
  } catch (err) {
    console.error('[prospeccao/pesquisas DELETE] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível excluir a pesquisa.' }, { status: 500 })
  }
}
