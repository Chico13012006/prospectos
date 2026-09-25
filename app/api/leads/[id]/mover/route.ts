// POST /api/leads/[id]/mover — Kanban: "Apenas mover" ou "Mover e enviar" a
// mensagem da etapa de destino (lib/pipeline/moverLeadServidor).
//
// Auth: sessão + escopo do lead (podeAcessarLead) para mover; enviar exige
// também `conversations.send` (mesma permissão da Central e da proposta). A
// organização vem da sessão; o corpo traz só { de, para, reuniao?, canal? }.
import { NextRequest, NextResponse } from 'next/server'
import { exigirPermissao, resolverAcesso } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'
import { moverLead } from '@/lib/pipeline/moverLeadServidor'
import { depsReaisMover } from '@/lib/pipeline/canaisMover'
import { STATUS_ERRO_MOVER } from '@/lib/pipeline/httpMover'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }
  const canal = corpo.canal ?? null

  const acc = canal === null ? await resolverAcesso() : await exigirPermissao('conversations.send')
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

  try {
    const vinculo = await resolverResponsavelPorAuthId(admin, org, user.id)
    const ator = vinculo.ok
      ? { usuarioId: vinculo.usuario.id, nome: vinculo.usuario.nome ?? null }
      : { usuarioId: null, nome: null }
    const r = await moverLead(
      admin,
      { leadId: id, organizacaoId: org, de: corpo.de, para: corpo.para, reuniao: corpo.reuniao, canal },
      ator,
      depsReaisMover(admin),
    )
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.mensagem, codigo: r.codigo }, { status: STATUS_ERRO_MOVER[r.codigo] ?? 400 })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[leads/mover POST] erro:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível mover o lead.' }, { status: 500 })
  }
}
