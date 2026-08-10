import { NextRequest, NextResponse } from 'next/server';
import { exigirPermissao, ressincronizarPermissoes } from '@/lib/rbac/servidor';

export async function POST(req: NextRequest) {
  try {
    // SEGURANÇA (Fase 1 RBAC): enforcement no BACKEND por permissão real
    // (`workspace.configure`), não pela checagem hardcoded de role. Admins têm
    // essa permissão pelo backfill (migration 0015), então o comportamento é
    // preservado. `acesso` traz o service_role client + a org de quem chama —
    // a fronteira de confiança continua sendo o servidor, nunca o corpo.
    const acc = await exigirPermissao('workspace.configure');
    if ('erro' in acc) return acc.erro;
    const { admin: supabaseAdmin, org } = acc.acesso;

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
      organizacao_id: org,
    });

    // RBAC (Fase 1): concede ao convidado o conjunto padrão de permissões do seu
    // role, para o novo membro já nascer autorizado corretamente.
    await ressincronizarPermissoes(supabaseAdmin, org, data.user.id, role);

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
      .eq('organizacao_id', org)
      .ilike('email', emailNorm);
    if (!jaExiste || jaExiste.length === 0) {
      const base: string[] = String(nome || emailNorm).split(/\s+/).filter(Boolean);
      const iniciais = base.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
      await supabaseAdmin.from('usuarios').insert({
        nome: nome || null,
        email: emailNorm,
        ativo: true,
        avatar_iniciais: iniciais || null,
        organizacao_id: org,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[equipe/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
