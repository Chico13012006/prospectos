// Biblioteca de templates da organização. GET exige `templates.view`; POST exige
// `templates.manage`. A organização vem sempre da sessão (exigirPermissao):
// organizacao_id em query string ou corpo é ignorado. Regras em lib/templates/.
import { NextResponse, type NextRequest } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { criarTemplate, listarTemplates } from '@/lib/templates/repository'
import { lerCorpoJson, respostaErroTemplate } from '@/lib/templates/http'
import { lerFiltrosTemplates } from '@/lib/templates/tipos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const acc = await exigirPermissao('templates.view')
  if ('erro' in acc) return acc.erro
  const filtros = lerFiltrosTemplates(req.nextUrl.searchParams)
  if (!filtros.ok) return NextResponse.json({ erro: filtros.erro }, { status: 400 })
  try {
    const templates = await listarTemplates(acc.acesso.admin, acc.acesso.org, filtros.valor)
    return NextResponse.json({ templates })
  } catch (erro) {
    return respostaErroTemplate(erro, 'GET')
  }
}

export async function POST(req: NextRequest) {
  const acc = await exigirPermissao('templates.manage')
  if ('erro' in acc) return acc.erro
  const corpo = await lerCorpoJson(req)
  if (!corpo.ok) return corpo.resposta
  try {
    const template = await criarTemplate(acc.acesso.admin, acc.acesso.org, acc.acesso.user.id, corpo.valor)
    return NextResponse.json({ template }, { status: 201 })
  } catch (erro) {
    return respostaErroTemplate(erro, 'POST')
  }
}
