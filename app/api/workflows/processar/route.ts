// Poll do motor de workflows (Fase 3). Varre TODAS as organizações ativas e, em
// cada uma: inscreve leads-alvo dos workflows publicados e avança as execuções
// pendentes (inclusive as esperas que venceram). Sem auth.uid() — usa o mesmo
// padrão do cron de follow-up (autorizar por segredo interno, service_role por
// org). Enquanto não houver workflow publicado numa org, o tick é inócuo.
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import { AmbienteSupabase, criarWorkflowStore, processarTudo, registrarBlocosPadrao } from '@/lib/workflows'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const registro = registrarBlocosPadrao()
    const orgs = await listarOrganizacoesAtivas()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      const store = criarWorkflowStore(org)
      const ambiente = new AmbienteSupabase(org)
      porOrg[org] = await processarTudo(store, registro, ambiente)
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[workflows/processar] erro:', err)
    return NextResponse.json({ erro: 'Erro interno do motor de workflows' }, { status: 500 })
  }
}

// POST para chamadas internas; GET para o Vercel Cron.
export const POST = executar
export const GET = executar
