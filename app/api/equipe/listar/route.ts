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
    // Os leads são atribuídos a um responsável da tabela `usuarios`. Já os
    // membros da equipe são usuários de auth; a ligação entre os dois é feita
    // pelo e-mail. `responsavel_id` NÃO é fonte de verdade hoje (100% null):
    // os leads do import HubSpot só têm `responsavel_nome`, com nome COMPLETO
    // ("Francisco Rufino") enquanto `usuarios.nome` é o curto ("Francisco").
    // Mesmo padrão de resolução de lib/api.ts (filtroResponsavelOr /
    // getLeadsPorResponsavel): casa por id OU prefixo case-insensitive do nome.
    const { data: usuarios } = await supabasePublic
      .from('usuarios').select('id, nome, email');
    const { data: leads } = await supabasePublic
      .from('leads').select('responsavel_id, responsavel_nome');

    const resolverUsuario = (l: { responsavel_id: string | null; responsavel_nome: string | null }) =>
      (usuarios ?? []).find(u =>
        u.id === l.responsavel_id ||
        (!!l.responsavel_nome && !!u.nome &&
          l.responsavel_nome.toLowerCase().startsWith(u.nome.toLowerCase()))
      );

    // usuarios.id -> total de leads atribuídos
    const leadsPorUsuario = new Map<string, number>();
    for (const l of leads ?? []) {
      const usr = resolverUsuario(l);
      if (!usr) continue;
      leadsPorUsuario.set(usr.id, (leadsPorUsuario.get(usr.id) ?? 0) + 1);
    }

    const membros = authData.users.map(u => {
      const perfil = perfis?.find(p => p.id === u.id);
      // Membro auth -> SDR de `usuarios`: por e-mail igual quando bate, senão
      // pelo mesmo padrão de prefixo (usuarios.nome curto como prefixo do
      // perfis.nome completo — os convites de auth usam e-mails pessoais que
      // não existem em `usuarios`, ex.: franrufs13@gmail.com). Trade-off: duas
      // contas do mesmo humano (ex.: "Francisco Rufs" admin e "Francisco
      // Rufino") mostram a MESMA contagem do SDR Francisco — preferível a
      // zerar a conta que a pessoa realmente usa.
      const emailMembro = u.email?.toLowerCase();
      const sdr =
        (usuarios ?? []).find(usr => usr.email?.toLowerCase() === emailMembro) ??
        (usuarios ?? []).find(usr =>
          !!perfil?.nome && !!usr.nome &&
          perfil.nome.toLowerCase().startsWith(usr.nome.toLowerCase())
        );
      const totalLeads = sdr ? (leadsPorUsuario.get(sdr.id) ?? 0) : 0;
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
