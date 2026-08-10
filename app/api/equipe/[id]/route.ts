// Edição e remoção de um membro da equipe. Ambos restritos a ADMIN e sempre
// DENTRO da própria organização de quem chama (mesma fronteira de confiança de
// /api/equipe/convidar e /listar). service_role bypassa RLS, então filtramos
// organizacao_id EXPLICITAMENTE.
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// Resolve quem chama e exige que seja admin. Retorna { user, org } ou uma
// NextResponse de erro pronta pra devolver.
async function exigirAdmin() {
  const server = await createSupabaseServerClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return { erro: NextResponse.json({ erro: 'Não autenticado' }, { status: 401 }) };

  const admin = createSupabaseAdminClient();
  const { data: perfil } = await admin
    .from('perfis').select('role, organizacao_id').eq('id', user.id).maybeSingle();
  if (!perfil || perfil.role !== 'admin') {
    return { erro: NextResponse.json({ erro: 'Apenas administradores podem gerenciar a equipe' }, { status: 403 }) };
  }
  if (!perfil.organizacao_id) {
    return { erro: NextResponse.json({ erro: 'Administrador sem organização' }, { status: 400 }) };
  }
  return { user, admin, org: perfil.organizacao_id as string };
}

// PATCH — editar nome, função (role) e nicho de um membro.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await exigirAdmin();
    if (ctx.erro) return ctx.erro;
    const { user, admin, org } = ctx;

    const body = await req.json();
    const nome: string | null = typeof body.nome === 'string' && body.nome.trim() ? body.nome.trim() : null;
    const role: string = body.role;
    const nicho: string | null = typeof body.nicho === 'string' && body.nicho ? body.nicho : null;
    if (role !== 'admin' && role !== 'usuario') {
      return NextResponse.json({ erro: 'Papel inválido' }, { status: 400 });
    }

    // O alvo precisa existir NA mesma organização.
    const { data: alvo } = await admin
      .from('perfis').select('id, role').eq('id', id).eq('organizacao_id', org).maybeSingle();
    if (!alvo) return NextResponse.json({ erro: 'Membro não encontrado' }, { status: 404 });

    // Trava de auto-rebaixamento: um admin não pode tirar o próprio acesso de
    // admin (evita a org ficar sem administrador por engano). Nome/nicho de si
    // mesmo continua livre.
    if (id === user.id && alvo.role === 'admin' && role !== 'admin') {
      return NextResponse.json({ erro: 'Você não pode remover seu próprio acesso de administrador. Peça a outro admin.' }, { status: 400 });
    }

    const { error } = await admin
      .from('perfis').update({ nome, role, nicho }).eq('id', id).eq('organizacao_id', org);
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    // Mantém usuarios.nome (o SDR ligado por e-mail) em sincronia com o perfil,
    // pra não divergir o nome exibido aqui do usado na atribuição de leads.
    const { data: authUser } = await admin.auth.admin.getUserById(id);
    const email = authUser?.user?.email?.toLowerCase();
    if (email) {
      await admin.from('usuarios').update({ nome }).eq('organizacao_id', org).ilike('email', email);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[equipe/[id] PATCH] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — remove o membro da plataforma: usuarios (SDR) -> perfis (login/role)
// -> auth.users (acesso). Ordem evita esbarrar na FK do perfil.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await exigirAdmin();
    if (ctx.erro) return ctx.erro;
    const { user, admin, org } = ctx;

    if (id === user.id) {
      return NextResponse.json({ erro: 'Você não pode remover a si mesmo.' }, { status: 400 });
    }

    // O alvo precisa existir NA mesma organização.
    const { data: alvo } = await admin
      .from('perfis').select('id').eq('id', id).eq('organizacao_id', org).maybeSingle();
    if (!alvo) return NextResponse.json({ erro: 'Membro não encontrado' }, { status: 404 });

    // e-mail do alvo pra localizar a linha em usuarios (ligada por e-mail).
    const { data: authUser } = await admin.auth.admin.getUserById(id);
    const email = authUser?.user?.email?.toLowerCase();
    if (email) {
      await admin.from('usuarios').delete().eq('organizacao_id', org).ilike('email', email);
    }

    const { error: eP } = await admin.from('perfis').delete().eq('id', id).eq('organizacao_id', org);
    if (eP) return NextResponse.json({ erro: eP.message }, { status: 400 });

    const { error: eA } = await admin.auth.admin.deleteUser(id);
    if (eA) return NextResponse.json({ erro: eA.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[equipe/[id] DELETE] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
