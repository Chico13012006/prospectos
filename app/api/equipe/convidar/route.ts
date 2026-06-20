import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const supabaseAdmin = createSupabaseAdminClient();

    const { email, nome, role = 'usuario', nicho } = await req.json();
    if (!email) return NextResponse.json({ erro: 'Email obrigatório' }, { status: 400 });

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha`,
    });

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    await supabaseAdmin.from('perfis').upsert({
      id: data.user.id,
      nome: nome || null,
      role,
      nicho: nicho || null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[equipe/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
