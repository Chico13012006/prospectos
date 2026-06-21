import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: authData, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    const { data: perfis } = await supabaseAdmin
      .from('perfis').select('id, nome, role, nicho, avatar_url');

    const supabasePublic = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: leads } = await supabasePublic.from('leads').select('responsavel');

    const membros = authData.users.map(u => {
      const perfil = perfis?.find(p => p.id === u.id);
      const totalLeads = leads?.filter(l => l.responsavel === u.email).length ?? 0;
      return {
        id: u.id,
        email: u.email,
        nome: perfil?.nome || null,
        role: perfil?.role || 'usuario',
        nicho: perfil?.nicho || null,
        confirmed_at: u.confirmed_at,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        total_leads: totalLeads,
        avatar_url: perfil?.avatar_url || null,
      };
    });

    return NextResponse.json({ membros });
  } catch (err) {
    console.error('[equipe/listar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
