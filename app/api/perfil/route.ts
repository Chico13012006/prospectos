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
      .select('nome, role, nicho, avatar_url, telefone')
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

    const { nome, nicho, avatar_url, telefone } = await req.json();

    // UPDATE (não upsert): o perfil já existe (criado no onboarding/convite). O
    // upsert fazia INSERT...ON CONFLICT, e o braço de INSERT viola o NOT NULL de
    // organizacao_id (multi-tenant, migrations 0006/0007) — quebrando todo save.
    // Update por id só mexe nas colunas do formulário e preserva organizacao_id/role.
    const admin = createSupabaseAdminClient();
    const { data: atualizado, error } = await admin
      .from('perfis')
      .update({ nome, nicho, avatar_url, telefone: telefone || null })
      .eq('id', user.id)
      .select('id')
      .maybeSingle();

    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
    if (!atualizado) return NextResponse.json({ erro: 'Perfil não encontrado para este usuário.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
