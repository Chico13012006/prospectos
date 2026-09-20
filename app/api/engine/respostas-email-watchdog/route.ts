import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { autorizar } from '@/lib/engine/http'
import { listarOrganizacoesAtivas } from '@/lib/engine'
import {
  agendarMonitorRespostas,
  haEnvioRecenteParaMonitorar,
  reativarMonitoresRespostas,
} from '@/lib/engine/respostasAutomaticas'

export const runtime = 'nodejs'

// Watchdog independente da fila. Não lê o Gmail nem processa respostas: apenas
// repõe a próxima mensagem deduplicável caso a cadeia rápida tenha sido perdida.
export async function GET(req: Request) {
  const negado = autorizar(req)
  if (negado) return negado

  try {
    const organizacoes = await listarOrganizacoesAtivas()
    const db = createSupabaseAdminClient()
    const resultado = await reativarMonitoresRespostas(organizacoes, {
      temEnvioRecente: (organizacaoId) => haEnvioRecenteParaMonitorar(db, organizacaoId),
      agendar: agendarMonitorRespostas,
    })
    return NextResponse.json(resultado, { status: resultado.erros.length > 0 ? 207 : 200 })
  } catch (erro) {
    console.error('[engine/respostas-email-watchdog] erro:', erro)
    return NextResponse.json({ erro: 'Erro interno do watchdog de respostas' }, { status: 500 })
  }
}
