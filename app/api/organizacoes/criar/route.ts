import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// Onboarding de NOVA organização (item 1 do sprint 04/08).
//
// Superfície PÚBLICA (fora da área logada) que cria, de uma vez:
//   1) a organização (tenant) em `organizacoes`;
//   2) o primeiro usuário ADMIN via Supabase Auth (senha já definida);
//   3) o `perfis` desse admin (role=admin, organizacao_id) — é o que a RLS usa
//      via current_org_id() pra isolar todo o dado da org;
//   4) a linha correspondente em `usuarios` (ligada por e-mail EXATO) — alvo de
//      leads.responsavel_id / CC do follow-up (mesma ponte de lib/leads/responsavel.ts).
//
// A org nasce VAZIA: não herda nada da CBA. O isolamento é garantido pela RLS
// (0006/0007) — cada linha carrega organizacao_id e current_org_id() filtra.
//
// GATE ANTI-ABUSO: como isto usa o service_role (bypassa RLS) sem sessão, exige
// um código compartilhado (ONBOARDING_SIGNUP_CODE) que o Chico entrega ao cliente
// novo. Sem a env var setada, o onboarding fica DESLIGADO (nunca abre por acidente).

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira acento (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'org';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const codigoEsperado = process.env.ONBOARDING_SIGNUP_CODE;
    if (!codigoEsperado) {
      // Feature desligada por padrão: sem código configurado, ninguém cria org.
      return NextResponse.json({ erro: 'Cadastro de novas organizações está desabilitado.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ erro: 'Corpo inválido' }, { status: 400 });

    const nomeOrg = String(body.nomeOrg ?? '').trim();
    const nome = String(body.nome ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const senha = String(body.senha ?? '');
    const codigo = String(body.codigo ?? '');

    if (codigo !== codigoEsperado) {
      return NextResponse.json({ erro: 'Código de acesso inválido.' }, { status: 403 });
    }
    if (!nomeOrg) return NextResponse.json({ erro: 'Nome da organização é obrigatório.' }, { status: 400 });
    if (!nome) return NextResponse.json({ erro: 'Seu nome é obrigatório.' }, { status: 400 });
    if (!EMAIL_RE.test(email)) return NextResponse.json({ erro: 'E-mail inválido.' }, { status: 400 });
    if (senha.length < 6) return NextResponse.json({ erro: 'A senha precisa de ao menos 6 caracteres.' }, { status: 400 });

    const admin = createSupabaseAdminClient();

    // 1) Organização — slug único (sufixo curto em caso de colisão).
    let slug = slugify(nomeOrg);
    let orgId: string | null = null;
    for (let tentativa = 0; tentativa < 5 && !orgId; tentativa++) {
      const candidato = tentativa === 0 ? slug : `${slug}-${Math.random().toString(16).slice(2, 6)}`;
      const { data, error } = await admin
        .from('organizacoes')
        .insert({ nome: nomeOrg, slug: candidato })
        .select('id')
        .single();
      if (!error && data) { orgId = data.id; break; }
      // 23505 = unique_violation no slug → tenta outro; qualquer outro erro aborta.
      if (error && error.code !== '23505') {
        console.error('[organizacoes/criar] falha ao criar org:', error);
        return NextResponse.json({ erro: 'Não foi possível criar a organização.' }, { status: 500 });
      }
    }
    if (!orgId) return NextResponse.json({ erro: 'Não foi possível gerar um identificador único para a organização.' }, { status: 500 });

    // 2) Usuário admin no Supabase Auth (senha já válida, sem passo de convite).
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (authErr || !created?.user) {
      await admin.from('organizacoes').delete().eq('id', orgId); // rollback org
      const jaExiste = /registered|already/i.test(authErr?.message ?? '');
      return NextResponse.json(
        { erro: jaExiste ? 'Já existe uma conta com este e-mail.' : 'Não foi possível criar o usuário.' },
        { status: 400 },
      );
    }
    const userId = created.user.id;

    // 3) Perfil admin — é o que current_org_id() (RLS) resolve.
    const { error: perfilErr } = await admin.from('perfis').insert({
      id: userId,
      nome,
      role: 'admin',
      organizacao_id: orgId,
    });
    if (perfilErr) {
      await admin.auth.admin.deleteUser(userId);
      await admin.from('organizacoes').delete().eq('id', orgId);
      console.error('[organizacoes/criar] falha ao criar perfil:', perfilErr);
      return NextResponse.json({ erro: 'Não foi possível vincular o usuário à organização.' }, { status: 500 });
    }

    // 4) Linha em `usuarios` (ligada por e-mail) — alvo de responsavel_id/CC.
    const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
    const { error: usuarioErr } = await admin.from('usuarios').insert({
      nome,
      email,
      ativo: true,
      avatar_iniciais: iniciais || null,
      organizacao_id: orgId,
    });
    if (usuarioErr) {
      await admin.from('perfis').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
      await admin.from('organizacoes').delete().eq('id', orgId);
      console.error('[organizacoes/criar] falha ao criar usuarios:', usuarioErr);
      return NextResponse.json({ erro: 'Não foi possível concluir o cadastro do usuário.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[organizacoes/criar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
