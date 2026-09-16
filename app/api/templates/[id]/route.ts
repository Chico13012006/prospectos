// Um template da biblioteca. GET exige `templates.view`; PATCH e DELETE exigem
// `templates.manage`. Id inexistente, de outra organização ou que não é UUID
// recebe o MESMO 404. DELETE não apaga: desativa, e responde 409 quando o
// template ainda sustenta workflow, campanha, execução ou a cadência do motor.
import { NextResponse, type NextRequest } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import {
  MENSAGEM_TEMPLATE_NAO_ENCONTRADO,
  atualizarTemplate,
  buscarTemplate,
  definirAtivoTemplate,
} from '@/lib/templates/repository'
import { lerCorpoJson, respostaErroTemplate } from '@/lib/templates/http'
import { ehUuid } from '@/lib/templates/tipos'

export const runtime = 'nodejs'

type Contexto = { params: Promise<{ id: string }> }

const naoEncontrado = () => NextResponse.json({ erro: MENSAGEM_TEMPLATE_NAO_ENCONTRADO }, { status: 404 })

export async function GET(_req: NextRequest, { params }: Contexto) {
  const acc = await exigirPermissao('templates.view')
  if ('erro' in acc) return acc.erro
  const { id } = await params
  try {
    const template = await buscarTemplate(acc.acesso.admin, acc.acesso.org, id)
    // Cópia `campanha_*` pertence à campanha, não à biblioteca.
    if (!template || template.somenteLeitura) return naoEncontrado()
    return NextResponse.json({ template })
  } catch (erro) {
    return respostaErroTemplate(erro, 'GET id')
  }
}

export async function PATCH(req: NextRequest, { params }: Contexto) {
  const acc = await exigirPermissao('templates.manage')
  if ('erro' in acc) return acc.erro
  const { id } = await params
  if (!ehUuid(id)) return naoEncontrado()
  const corpo = await lerCorpoJson(req)
  if (!corpo.ok) return corpo.resposta
  try {
    const template = await atualizarTemplate(acc.acesso.admin, acc.acesso.org, acc.acesso.user.id, id, corpo.valor)
    return NextResponse.json({ template })
  } catch (erro) {
    return respostaErroTemplate(erro, 'PATCH')
  }
}

export async function DELETE(_req: NextRequest, { params }: Contexto) {
  const acc = await exigirPermissao('templates.manage')
  if ('erro' in acc) return acc.erro
  const { id } = await params
  if (!ehUuid(id)) return naoEncontrado()
  try {
    const template = await definirAtivoTemplate(acc.acesso.admin, acc.acesso.org, acc.acesso.user.id, id, false)
    return NextResponse.json({ template })
  } catch (erro) {
    return respostaErroTemplate(erro, 'DELETE')
  }
}
