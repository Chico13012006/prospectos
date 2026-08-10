// Cron da renovação (Fase 4.3). Varre TODAS as organizações ativas e processa a
// janela de renovação de cada uma (cria tarefa + notificação + 1ª mensagem +
// execução). Autorizado pelo segredo interno (mesmo padrão do follow-up).
// NÃO está agendado na Vercel ainda — inócuo até ser ligado deliberadamente e
// existir template de renovação. Envio real segue gated por MODO_ENSAIO.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import { processarRenovacoes } from '@/lib/renovacao/processar'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const orgs = await listarOrganizacoesAtivas()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) porOrg[org] = await processarRenovacoes(org)
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[renovacao/processar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}

export const POST = executar
export const GET = executar
