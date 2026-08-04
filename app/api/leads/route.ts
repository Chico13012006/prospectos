import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { emailValido } from '@/lib/leads/importarCsv'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'

// Cadastro MANUAL de 1 lead (2.3, botão "Novo lead"). Server-side com service
// role. O responsável é o PRÓPRIO usuário logado (não há seletor aqui) — mesmo
// bridge auth→usuarios do import, com o authId = user.id. Bloqueia e avisa se o
// usuário logado não vincular a um `usuarios` real (senão o lead ficaria sem CC).

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

    const body = await req.json()
    const nome = String(body.nome ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const empresa = String(body.empresa ?? '').trim()
    const origem = String(body.origem ?? '').trim()
    const telefone = String(body.telefone ?? '').trim().replace(/[^\d+]/g, '') || null
    const cargo = String(body.cargo ?? '').trim() || null
    const cidade = String(body.cidade ?? '').trim() || null
    const estado = String(body.estado ?? '').trim() || null

    // Validação dos obrigatórios de 2.1.
    if (!nome) return NextResponse.json({ erro: 'Informe o nome.' }, { status: 400 })
    if (!email || !emailValido(email)) return NextResponse.json({ erro: 'Informe um e-mail válido.' }, { status: 400 })
    if (!empresa) return NextResponse.json({ erro: 'Informe a empresa.' }, { status: 400 })
    if (!origem) return NextResponse.json({ erro: 'Escolha a origem.' }, { status: 400 })

    // Responsável = usuário logado, resolvido para uma linha de `usuarios`.
    const vinculo = await resolverResponsavelPorAuthId(admin, org, user.id)
    if (!vinculo.ok) {
      const detalhe = vinculo.motivo === 'ambiguo' ? vinculo.detalhe : undefined
      return NextResponse.json(
        {
          erro: 'Sua conta ainda não está vinculada a um usuário comercial (usuarios). Cadastre/ajuste em usuarios para o lead sair com você em cópia nos follow-ups.',
          motivo: vinculo.motivo,
          detalhe,
        },
        { status: 400 },
      )
    }

    // Dedupe leve: evita duplicar o mesmo e-mail na organização.
    const { data: jaExiste } = await admin
      .from('leads').select('id').eq('organizacao_id', org).eq('contato_email', email).limit(1).maybeSingle()
    if (jaExiste) {
      return NextResponse.json({ erro: 'Já existe um lead com esse e-mail na sua base.' }, { status: 409 })
    }

    const { data: lead, error } = await admin
      .from('leads')
      .insert({
        organizacao_id: org,
        owner: 'engine',
        estagio: 'novos_leads',
        followups_enviados: 0,
        canal_preferencial: 'email',
        perdido: false,
        score: 50,
        contato_nome: nome,
        contato_email: email,
        empresa,
        origem,
        contato_telefone: telefone,
        contato_cargo: cargo,
        cidade,
        estado,
        responsavel_id: vinculo.usuario.id,
        responsavel_nome: vinculo.usuario.nome,
      })
      .select('*, usuarios:responsavel_id (id, nome)')
      .single()

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 })
    return NextResponse.json({ lead })
  } catch (err) {
    console.error('[leads POST] erro:', err)
    return NextResponse.json({ erro: 'Erro interno ao criar o lead.' }, { status: 500 })
  }
}
