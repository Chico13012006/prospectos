// POST /api/leads/[id]/mover/previa — prévia da mensagem da etapa no modal do
// Kanban. Sem efeito: não envia, não move, não grava. Mesmas travas e mesma
// autorização do envio (conversations.send + escopo do lead).
import { NextRequest, NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { previaMover } from '@/lib/pipeline/moverLeadServidor'
import { modoEnsaioMover } from '@/lib/pipeline/canaisMover'
import { STATUS_ERRO_MOVER } from '@/lib/pipeline/httpMover'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('conversations.send')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  try {
    const r = await previaMover(
      admin,
      { leadId: id, organizacaoId: org, de: corpo.de, para: corpo.para, reuniao: corpo.reuniao, canal: corpo.canal },
      { modoEnsaio: modoEnsaioMover },
    )
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.mensagem, codigo: r.codigo }, { status: STATUS_ERRO_MOVER[r.codigo] ?? 400 })
    return NextResponse.json(r)
  } catch (e) {
    console.error('[leads/mover/previa POST] erro:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Não foi possível montar a prévia.' }, { status: 500 })
  }
}
