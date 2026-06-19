import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    // 1. Validar body
    const body = await req.json();
    if (!body.lead_id) {
      return NextResponse.json({ erro: 'lead_id é obrigatório' }, { status: 400 });
    }

    // 2. Verificar URL do n8n
    const url = process.env.N8N_EXECUTAR_ACAO_URL;
    if (!url) {
      return NextResponse.json({ erro: 'URL do n8n não configurada no servidor' }, { status: 500 });
    }

    // 3. Chamar n8n (server-side, sem CORS)
    const n8nRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: body.lead_id }),
    });

    const data = await n8nRes.json();
    return NextResponse.json(data, { status: n8nRes.ok ? 200 : 500 });

  } catch (err) {
    console.error('[executar-acao] erro interno:', err);
    return NextResponse.json({ erro: 'Erro interno do servidor' }, { status: 500 });
  }
}
