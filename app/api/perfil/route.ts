import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// GET — buscar perfil do usuário logado
export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data: perfil } = await admin
      .from('perfis')
      .select('nome, role, nicho, avatar_url')
      .eq('id', user.id)
      .single();

    return NextResponse.json({ perfil: perfil || null, email: user.email });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}

// POST — salvar/atualizar perfil do usuário logado
export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const { nome, nicho, avatar_url } = await req.json();

    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('perfis')
      .upsert({ id: user.id, nome, nicho, avatar_url });

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
