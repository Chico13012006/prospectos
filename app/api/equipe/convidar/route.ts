import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const supabaseAdmin = createSupabaseAdminClient();

    // SEGURANÇA (Fase 1): só ADMIN convida, e sempre DENTRO da própria
    // organização. Antes esta rota aceitava `role` de qualquer usuário logado —
    // qualquer um se auto-promovia (ou promovia terceiros) a admin. Agora o
    // perfil de quem chama é a fonte de verdade de role E de organizacao_id.
    const { data: convidante } = await supabaseAdmin
      .from('perfis')
      .select('role, organizacao_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!convidante || convidante.role !== 'admin') {
      return NextResponse.json({ erro: 'Apenas administradores podem convidar' }, { status: 403 });
    }
    if (!convidante.organizacao_id) {
      return NextResponse.json({ erro: 'Convidante sem organização' }, { status: 400 });
    }

    const { email, nome, role = 'usuario', nicho } = await req.json();
    if (!email) return NextResponse.json({ erro: 'Email obrigatório' }, { status: 400 });
    // Só papéis conhecidos; nunca deixa o corpo injetar valor arbitrário.
    if (role !== 'admin' && role !== 'usuario') {
      return NextResponse.json({ erro: 'Papel inválido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha`,
    });

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    await supabaseAdmin.from('perfis').upsert({
      id: data.user.id,
      nome: nome || null,
      role,
      nicho: nicho || null,
      // Novo usuário SEMPRE na organização de quem convida (fronteira de confiança).
      organizacao_id: convidante.organizacao_id,
    });

    // Garante a linha correspondente em `usuarios` (ligada por e-mail EXATO) já
    // no convite. Antes o convite só criava acesso de login (perfis) e NÃO a
    // linha em usuarios — foi o que causou o bug de CC do follow-up (Rufs/Rufino):
    // leads.responsavel_id aponta p/ usuarios, e sem essa linha o motor não achava
    // o responsável. Idempotente: se já existe usuarios com este e-mail na org,
    // não duplica. Ver [[leads-responsavel-data-model]] e lib/leads/responsavel.ts.
    const emailNorm = String(email).trim().toLowerCase();
    const { data: jaExiste } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .eq('organizacao_id', convidante.organizacao_id)
      .ilike('email', emailNorm);
    if (!jaExiste || jaExiste.length === 0) {
      const base: string[] = String(nome || emailNorm).split(/\s+/).filter(Boolean);
      const iniciais = base.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
      await supabaseAdmin.from('usuarios').insert({
        nome: nome || null,
        email: emailNorm,
        ativo: true,
        avatar_iniciais: iniciais || null,
        organizacao_id: convidante.organizacao_id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[equipe/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
