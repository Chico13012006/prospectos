// Preview da PRÓXIMA mensagem da cadência de um lead (ficha lateral, item 2 do
// doc de ajustes — botão "Gerar mensagem"). Não envia nada: só monta o e-mail
// que o motor mandaria a seguir (template por nicho/estágio + variáveis
// preenchidas), reaproveitando lib/engine/mensagem.ts. SERVER-ONLY.
//
// Auth por sessão; o lead é validado contra a organização do usuário logado.
import { NextRequest, NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { criarMotor } from '@/lib/engine'
import { montarEmail, type Envio } from '@/lib/engine/mensagem'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const acc = await resolverAcesso()
    if ('erro' in acc) return acc.erro
    const { admin, org } = acc.acesso
    if (!(await podeAcessarLead(acc.acesso, id))) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    // Trava de tenant: o lead precisa ser da org do usuário.
    const { data: leadRow } = await admin
      .from('leads').select('id').eq('id', id).eq('organizacao_id', org).maybeSingle()
    if (!leadRow) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    const motor = criarMotor(org)
    const lead = await motor.store.buscarLead(id)
    if (!lead) return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })

    // Próximo envio: se ainda não houve 1º contato, é a abordagem; senão, o
    // próximo follow-up (o número só define o espaçamento, não o conteúdo).
    const jaAbordou = (await motor.store.contarInteracoes(id, 'abordagem')) > 0
    const envio: Envio = jaAbordou
      ? { tipo: 'follow_up', numero: (lead.followups_enviados ?? 0) + 1 }
      : { tipo: 'abordagem' }

    const { assunto, corpo } = await montarEmail(motor.store, lead, envio)
    return NextResponse.json({ assunto, corpo, tipo: envio.tipo, numero: envio.numero ?? null })
  } catch (err) {
    console.error('[leads/mensagem POST] erro:', err)
    const msg = err instanceof Error ? err.message : 'Erro ao gerar a mensagem.'
    return NextResponse.json({ erro: msg }, { status: 500 })
  }
}
