// Pesquisas salvas da Prospecção. GET para qualquer sessão (a equipe usa os
// atalhos); criar exige workspace.configure, como o perfil de busca.
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { adicionarPesquisa } from '@/lib/prospeccao/pesquisas'
import { gravarPesquisas, lerConfig } from '@/lib/prospeccao/pesquisasServidor'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, permissoes } = acc.acesso
  try {
    const config = await lerConfig(admin, org)
    return NextResponse.json({ pesquisas: config.prospeccaoPesquisas ?? [], podeEditar: permissoes.has('workspace.configure') })
  } catch (err) {
    console.error('[prospeccao/pesquisas GET] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível carregar as pesquisas salvas.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const acc = await exigirPermissao('workspace.configure')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  try {
    const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown; filtros?: unknown; quantidade?: unknown }
    const config = await lerConfig(admin, org)
    const r = adicionarPesquisa(config.prospeccaoPesquisas ?? [], corpo, randomUUID(), new Date().toISOString())
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    const pesquisas = await gravarPesquisas(admin, org, config, r.lista)
    return NextResponse.json({ pesquisas }, { status: 201 })
  } catch (err) {
    console.error('[prospeccao/pesquisas POST] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível salvar a pesquisa.' }, { status: 500 })
  }
}
