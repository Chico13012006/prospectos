// "Executar ação" da ficha do lead: dispara a próxima etapa da cadência pelo
// motor (lib/engine). É a porta do USUÁRIO para o mesmo fluxo de
// /api/engine/executar-acao — aquela rota fica para chamadas internas (segredo
// no servidor); esta autentica pela sessão, sem segredo no navegador.
//
// Auth: `conversations.send` (mandar mensagem a um lead é trabalho do
// comercial) + escopo do lead (podeAcessarLead) + trava de tenant. As travas do
// envio (owner='engine', opt-out, bounce, idempotência, limite diário,
// MODO_ENSAIO) continuam todas dentro de executarAcao().
import { NextRequest, NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { criarMotor, executarAcao } from '@/lib/engine'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const acc = await exigirPermissao('conversations.send')
    if ('erro' in acc) return acc.erro
    const { admin, org } = acc.acesso
    if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    // Trava de tenant: o lead precisa ser da org do usuário.
    const { data: leadRow } = await admin
      .from('leads').select('id').eq('id', id).eq('organizacao_id', org).maybeSingle()
    if (!leadRow) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    const motor = criarMotor(org)
    // 1º contato (abordagem) sai pela conta de PROSPECÇÃO (item 2.7).
    const r = await executarAcao(motor.store, motor.emailProspeccao, { leadId: id })
    return NextResponse.json(r, { status: r.ok ? 200 : 409 })
  } catch (err) {
    console.error('[leads/executar-acao POST] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor' }, { status: 500 })
  }
}
