import { NextRequest, NextResponse } from 'next/server';
import { exigirPermissao, ressincronizarPermissoes } from '@/lib/rbac/servidor';
import { GmailProvider, lerCredenciaisGmail } from '@/lib/engine/email/gmailProvider';
import { engineConfig } from '@/lib/engine/config';
import { montarEmailCampanhaHtml } from '@/lib/campanhas/emailCampanha';

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

    // `generateLink` cria o usuário de auth (igual `inviteUserByEmail`), mas NÃO
    // dispara o e-mail padrão do Supabase (remetente genérico, rate-limited).
    // O e-mail de convite sai abaixo, pela conta Gmail PRINCIPAL (mesma do
    // motor/Central — GMAIL_USER/GMAIL_APP_PASSWORD), a pedido do usuário.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/definir-senha` },
    });

    if (error || !data?.user) {
      return NextResponse.json({ erro: error?.message ?? 'Falha ao gerar convite' }, { status: 400 });
    }

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

    // Envio do convite pela conta Gmail principal. O usuário e as linhas de
    // perfis/usuarios acima já existem mesmo se o e-mail falhar — nunca
    // desfazemos o convite por isso; devolvemos o link p/ o admin repassar
    // manualmente se o envio não sair (sem credencial ou falha de SMTP).
    const actionLink = data.properties?.action_link ?? null;
    const cred = lerCredenciaisGmail();
    if (!cred) {
      console.error('[equipe/convidar] GMAIL_USER/GMAIL_APP_PASSWORD ausentes — convite criado, e-mail não enviado.');
      return NextResponse.json({ ok: true, emailEnviado: false, link: actionLink });
    }

    const { data: orgRow } = await supabaseAdmin
      .from('organizacoes').select('nome, configuracoes').eq('id', org).maybeSingle();
    const orgData = orgRow as { nome?: string; configuracoes?: Record<string, unknown> } | null;
    const nomenclaturas = orgData?.configuracoes?.['nomenclaturas'] as Record<string, string> | undefined;
    const nomeServico = nomenclaturas?.['nome_servico'] ?? orgData?.nome ?? 'ProspectOS';

    const corpoTexto = `Você foi convidado para acessar a plataforma ${nomeServico}.\n\nAcesse o link abaixo para definir sua senha e ativar seu acesso:\n${actionLink}\n\nSe você não esperava este convite, ignore este e-mail.`;
    const htmlPersonalizado = `
      <p>Você foi convidado para acessar a plataforma <strong>${nomeServico}</strong>.</p>
      <p>Clique no botão abaixo para definir sua senha e ativar seu acesso:</p>
      <p><a href="${actionLink}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Definir senha e acessar</a></p>
      <p style="color:#64748b;font-size:12px;">Se o botão não funcionar, copie e cole este link no navegador:<br>${actionLink}</p>
      <p style="color:#64748b;font-size:12px;">Se você não esperava este convite, ignore este e-mail.</p>
    `;
    const html = montarEmailCampanhaHtml(corpoTexto, { nomeServico }, htmlPersonalizado);

    try {
      await new GmailProvider(cred).enviar(email, `Convite para acessar ${nomeServico}`, corpoTexto, html);
    } catch (e) {
      console.error('[equipe/convidar] falha ao enviar e-mail de convite:', e);
      return NextResponse.json({ ok: true, emailEnviado: false, link: actionLink });
    }

    // GmailProvider.enviar já respeita MODO_ENSAIO (só loga, não envia) — a
    // resposta reflete isso pra UI não afirmar um envio que não saiu.
    return NextResponse.json({
      ok: true,
      emailEnviado: !engineConfig.modoEnsaio,
      simulado: engineConfig.modoEnsaio,
      link: actionLink,
    });
  } catch (err) {
    console.error('[equipe/convidar] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 });
  }
}
