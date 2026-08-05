import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { validarTokenOptout } from '@/lib/engine/optout';

// Opt-out público de follow-up (sprint item 2.4). SEM login — a identidade vem
// do token HMAC específico do lead (?lead=<id>&t=<token>). Só afeta AQUELE lead.
//
// Padrão de DUAS etapas de propósito: GET só RENDERIZA uma página de confirmação
// (não muda nada); a baixa acontece no POST do botão. Isso evita que scanners de
// link de e-mail (Outlook SafeLinks, antivírus) que fazem prefetch do GET
// cancelem o lead sozinhos — o que faria a empresa perder contatos por engano.

function pagina(titulo: string, corpoHtml: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${titulo}</title></head>
<body style="margin:0;background:#0f1117;color:#e2e8f0;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:440px;margin:64px auto;background:#1a1f2e;border-radius:16px;padding:32px;text-align:center">
${corpoHtml}
</div></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Página de confirmação (GET): botão que faz POST para efetivar.
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead') ?? '';
  const token = req.nextUrl.searchParams.get('t') ?? '';
  if (!validarTokenOptout(leadId, token)) {
    return pagina('Link inválido', '<h1 style="font-size:18px">Link inválido</h1><p style="color:#94a3b8;font-size:14px">Este link de cancelamento é inválido ou expirou.</p>', 400);
  }
  const acao = `/api/optout?lead=${encodeURIComponent(leadId)}&t=${encodeURIComponent(token)}`;
  return pagina(
    'Cancelar recebimento',
    `<h1 style="font-size:18px;margin-top:0">Cancelar recebimento</h1>
<p style="color:#94a3b8;font-size:14px">Confirme que você não quer mais receber nossos e-mails. Você pode fechar esta página se clicou por engano.</p>
<form method="POST" action="${acao}" style="margin-top:20px">
<button type="submit" style="background:#4f46e5;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer">Sim, cancelar o recebimento</button>
</form>`,
  );
}

// Efetiva o opt-out (POST). Idempotente: se já estava opted-out, só confirma.
export async function POST(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get('lead') ?? '';
  const token = req.nextUrl.searchParams.get('t') ?? '';
  if (!validarTokenOptout(leadId, token)) {
    return pagina('Link inválido', '<h1 style="font-size:18px">Link inválido</h1><p style="color:#94a3b8;font-size:14px">Este link de cancelamento é inválido ou expirou.</p>', 400);
  }

  const admin = createSupabaseAdminClient();
  const { data: lead } = await admin.from('leads').select('id, optout').eq('id', leadId).maybeSingle();
  if (!lead) {
    return pagina('Não encontrado', '<h1 style="font-size:18px">Contato não encontrado</h1>', 404);
  }
  if (!lead.optout) {
    const { error } = await admin
      .from('leads')
      .update({
        optout: true,
        optout_em: new Date().toISOString(),
        // Sai do board ativo; a flag optout é a trava de verdade no motor.
        estagio: 'descartado',
        proxima_acao: null,
        proxima_acao_data: null,
      })
      .eq('id', leadId);
    if (error) {
      console.error('[optout] falha ao atualizar lead:', error);
      return pagina('Erro', '<h1 style="font-size:18px">Não foi possível concluir</h1><p style="color:#94a3b8;font-size:14px">Tente novamente em instantes.</p>', 500);
    }
  }
  return pagina(
    'Cancelado',
    '<h1 style="font-size:18px;margin-top:0">Pronto!</h1><p style="color:#94a3b8;font-size:14px">Você não receberá mais e-mails automáticos da nossa parte.</p>',
  );
}
