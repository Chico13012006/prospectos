// Acompanhamento do handoff (Fase 3) — cron DIÁRIO do domínio comercial e
// gatilho manual/interno. Para cada organização: roda um tick (processa os
// check-ins vencidos) e RE-SEMEIA a corrente da fila durável se houver o que
// esperar — rede de segurança para deploy/queda da corrente. O funcionamento
// normal NÃO depende desta rota: a corrente nasce no próprio handoff e se
// reagenda sozinha (lib/comercial/handoff/acompanhamentoScheduler).
// Protegida por INTERNAL_SECRET/CRON_SECRET como /api/engine/*. GET para o
// Vercel Cron; POST para chamadas internas (body opcional { organizacaoId }).
import { NextResponse } from 'next/server'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { executarTickAcompanhamentoOrg } from '@/lib/comercial/handoff/composicao'
import { reprocessarComandosGrupoOrg } from '@/lib/comercial/grupo/composicao'

export const runtime = 'nodejs'

async function executar(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado
  try {
    const body = req.method === 'POST' ? (await req.json().catch(() => null)) as { organizacaoId?: unknown } | null : null
    const orgs = typeof body?.organizacaoId === 'string' && body.organizacaoId.trim()
      ? [body.organizacaoId.trim()]
      : await listarOrganizacoesAtivas()
    const admin = createSupabaseAdminClient()
    const porOrg: Record<string, unknown> = {}
    for (const org of orgs) {
      try {
        // Fase 4: comandos do grupo que ficaram recebidos/falhos/presos.
        let comandos: unknown = null
        try { comandos = await reprocessarComandosGrupoOrg(admin, org) } catch (e) { comandos = { erro: e instanceof Error ? e.message : String(e) } }
        const { resumo: r, proximo } = await executarTickAcompanhamentoOrg(admin, org)
        porOrg[org] = {
          comandos,
          janelaMinutos: r.janelaMinutos, abertos: r.abertos, vencidos: r.vencidos, enviados: r.enviados,
          jaEnviados: r.jaEnviados, pendentes: r.pendentes, ignorados: r.ignorados,
          proximoVencimentoEm: r.proximoVencimentoEm,
          proximoTickEm: proximo?.agendadoPara ?? null,
          resultados: r.resultados.map((x) => ({ handoffId: x.handoffId, tipo: x.tipo, ...('motivo' in x ? { motivo: x.motivo } : {}) })),
        }
      } catch (e) {
        porOrg[org] = { erro: e instanceof Error ? e.message : String(e) }
      }
    }
    return NextResponse.json({ organizacoes: orgs.length, porOrg })
  } catch (err) {
    console.error('[comercial/handoff/acompanhamento] erro:', err)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}

export const POST = executar
export const GET = executar
