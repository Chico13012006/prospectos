import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });
    return NextResponse.json({ users: data.users });
  } catch (err) {
    console.error('[equipe/listar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
