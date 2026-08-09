// Criação de template / VARIANTE (A/B testing, item 6). Uma "variante" é só
// outra linha ativa com a MESMA chave (nicho, tipo, canal) — o motor então
// alterna entre elas por lead. Auth por sessão; grava sempre na organização do
// usuário (a organizacao_id NÃO vem do cliente). SERVER-ONLY.
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const CANAIS = new Set(['email', 'linkedin', 'whatsapp', 'telefone'])

export async function POST(req: NextRequest) {
  try {
    const server = await createSupabaseServerClient()
    const { data: { user } } = await server.auth.getUser()
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

    const admin = createSupabaseAdminClient()
    const { data: perfil } = await admin
      .from('perfis').select('organizacao_id').eq('id', user.id).maybeSingle()
    const org = perfil?.organizacao_id as string | undefined
    if (!org) return NextResponse.json({ erro: 'Usuário sem organização' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    const nome = String(body.nome ?? '').trim()
    const tipo = String(body.tipo ?? '').trim()
    const canal = String(body.canal ?? '').trim()
    const nichoRaw = String(body.nicho ?? '').trim()
    const nicho = nichoRaw || null // vazio = genérico
    const assunto = String(body.assunto ?? '').trim() || null
    const corpo = String(body.corpo ?? '').trim()

    if (!nome) return NextResponse.json({ erro: 'Informe um nome para a variante.' }, { status: 400 })
    if (!tipo) return NextResponse.json({ erro: 'Estágio (tipo) é obrigatório.' }, { status: 400 })
    if (!CANAIS.has(canal)) return NextResponse.json({ erro: 'Canal inválido.' }, { status: 400 })
    if (!corpo) return NextResponse.json({ erro: 'O corpo do template é obrigatório.' }, { status: 400 })

    const { data, error } = await admin
      .from('templates')
      .insert({ nome, tipo, canal, nicho, assunto, corpo, ativo: true, organizacao_id: org })
      .select('id, nome, tipo, canal, nicho, assunto, corpo, ativo')
      .single()
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
    return NextResponse.json({ template: data })
  } catch (err) {
    console.error('[templates POST] erro:', err)
    return NextResponse.json({ erro: 'Erro ao criar o template.' }, { status: 500 })
  }
}
