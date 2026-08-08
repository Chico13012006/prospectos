// Copiloto pós-reunião (sprint item 8). Recebe a transcrição colada + o lead,
// chama a IA (Opus) e devolve a análise estruturada. Auth por sessão; o lead
// (para contexto) é lido escopado à organização do usuário. SERVER-ONLY.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { iaConfigurada } from '@/lib/ia/cliente'
import { analisarReuniao } from '@/lib/ia/copilotoReuniao'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    if (!iaConfigurada()) {
      return NextResponse.json({ erro: 'IA não configurada (ANTHROPIC_API_KEY ausente).' }, { status: 503 })
    }
    const server = await createSupabaseServerClient()
    const { data: { user } } = await server.auth.getUser()
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

    const admin = createSupabaseAdminClient()
    const { data: perfil } = await admin
      .from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle()
    const org = perfil?.organizacao_id as string | undefined
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 })

    const body = await req.json().catch(() => null)
    const transcricao = String(body?.transcricao ?? '').trim()
    const leadId = body?.leadId ? String(body.leadId) : null
    if (transcricao.length < 20) {
      return NextResponse.json({ erro: 'Cole a transcrição da reunião (texto muito curto).' }, { status: 400 })
    }

    // Contexto do lead (opcional) — só se o lead for da org do usuário.
    let contexto: { empresa?: string | null; contato?: string | null } | undefined
    if (leadId) {
      const { data: lead } = await admin
        .from('leads').select('empresa, contato_nome')
        .eq('id', leadId).eq('organizacao_id', org).maybeSingle()
      if (lead) contexto = { empresa: lead.empresa, contato: lead.contato_nome }
    }

    const analise = await analisarReuniao(transcricao, contexto)
    return NextResponse.json({ analise })
  } catch (err) {
    console.error('[copiloto POST] erro:', err)
    return NextResponse.json({ erro: 'Erro ao analisar a reunião.' }, { status: 500 })
  }
}
