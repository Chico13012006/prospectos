// Cron da renovação (Fase 4.3). Varre TODAS as organizações ativas e processa a
// janela de renovação de cada uma (cria tarefa + notificação + 1ª mensagem +
// execução). Autorizado por INTERNAL_SECRET ou CRON_SECRET. Está agendado no
// vercel.json; o envio real ainda exige campanha ativa, dry_run=false,
// RENOVACAO_ENVIO_REAL=true e MODO_ENSAIO=false.
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
