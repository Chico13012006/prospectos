// Edição e remoção de um membro da equipe. Ambos exigem a permissão
// `workspace.configure` (RBAC Fase 1) — enforcement no BACKEND, sempre DENTRO da
// própria organização. service_role bypassa RLS, então filtramos organizacao_id
// EXPLICITAMENTE. A trava do ÚLTIMO administrador vive em lib/rbac/guards.ts.
import { NextRequest, NextResponse } from 'next/server';
import { exigirPermissao, contarAdmins, ressincronizarPermissoes } from '@/lib/rbac/servidor';
import { podeAlterarRole, podeRemoverMembro } from '@/lib/rbac/guards';

export const runtime = 'nodejs';

// PATCH — editar nome, função (role) e nicho de um membro.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { admin, org } = acc.acesso;

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

    // Trava do último administrador: não rebaixar o único admin da organização
    // (cobre também o auto-rebaixamento). Regra pura, testável.
    const totalAdmins = await contarAdmins(admin, org);
    const regra = podeAlterarRole({ alvoRole: alvo.role, novoRole: role, totalAdmins });
    if (!regra.ok) return NextResponse.json({ erro: regra.erro }, { status: regra.status });

    const { error } = await admin
      .from('perfis').update({ nome, role, nicho }).eq('id', id).eq('organizacao_id', org);
    if (error) return NextResponse.json({ erro: error.message }, { status: 400 });

    // RBAC: se o role mudou, as permissões passam a ser as do novo role.
    if (role !== alvo.role) {
      await ressincronizarPermissoes(admin, org, id, role);
    }

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

// DELETE — remove o membro da plataforma: perfis (login/role, que cascateia
// perfil_permissoes) -> usuarios (SDR) -> auth.users (acesso).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { user, admin, org } = acc.acesso;

    // O alvo precisa existir NA mesma organização.
    const { data: alvo } = await admin
      .from('perfis').select('id, role').eq('id', id).eq('organizacao_id', org).maybeSingle();
    if (!alvo) return NextResponse.json({ erro: 'Membro não encontrado' }, { status: 404 });

    // Travas: não remover a si mesmo nem o último administrador da organização.
    const totalAdmins = await contarAdmins(admin, org);
    const regra = podeRemoverMembro({ alvoId: id, alvoRole: alvo.role, chamadorId: user.id, totalAdmins });
    if (!regra.ok) return NextResponse.json({ erro: regra.erro }, { status: regra.status });

    // e-mail do alvo pra localizar a linha em usuarios (ligada por e-mail).
    const { data: authUser } = await admin.auth.admin.getUserById(id);
    const email = authUser?.user?.email?.toLowerCase();
    if (email) {
      await admin.from('usuarios').delete().eq('organizacao_id', org).ilike('email', email);
    }

    // perfis primeiro: o on delete cascade limpa perfil_permissoes junto.
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
