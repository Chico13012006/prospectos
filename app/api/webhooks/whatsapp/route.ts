import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Webhook do WhatsApp Cloud API (Meta). Rota PÚBLICA — a Meta chama de fora,
// sem sessão nem cabeçalho interno. Por isso não usa resolverAcesso()/
// exigirPermissao() (não há usuário logado aqui) nem organizacao_id (ainda não
// existe roteamento de número → organização; é o que a Fase 2 desta feature
// resolve, quando a lógica de negócio for implementada).
//
// Duas responsabilidades, e só isso por enquanto:
//   GET  — handshake de verificação exigido pela Meta ao configurar o webhook.
//   POST — recebimento de evento. Registra em log e responde 200 rápido; a
//          Meta reenvia com backoff se não receber 200 em poucos segundos, e o
//          reenvio duplicaria o evento se a lógica de negócio (ainda não
//          escrita) não for idempotente.
//
// WHATSAPP_VERIFY_TOKEN é uma string secreta que NÓS escolhemos e cadastramos
// no painel da Meta — não é o access token da conta, que autentica chamadas da
// ProspectOS PARA a Meta (envio de mensagem), não o inverso.

// GET — handshake de verificação (Meta > Configuration > Webhooks > Verify).
export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get('hub.mode')
  const tokenRecebido = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  const tokenEsperado = process.env.WHATSAPP_VERIFY_TOKEN
  if (!tokenEsperado) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'WHATSAPP_VERIFY_TOKEN não configurada no ambiente — verificação da Meta recusada.',
    }))
    return new NextResponse('Webhook não configurado.', { status: 403 })
  }

  if (modo === 'subscribe' && tokenRecebido === tokenEsperado && challenge) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
      msg: 'Verificação da Meta concluída.',
    }))
    // A Meta exige o challenge como corpo TEXTO puro, sem envelope JSON.
    return new NextResponse(challenge, { status: 200 })
  }

  console.error(JSON.stringify({
    ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
    msg: 'Verificação da Meta recusada — modo ou token não conferem.', modo,
  }))
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — evento recebido (mensagem, status de entrega, etc.). Sem lógica de
// negócio nesta rodada: só log estruturado do payload e 200 imediato.
export async function POST(req: NextRequest) {
  let corpo: unknown = null
  try {
    corpo = await req.json()
  } catch {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.whatsapp',
      msg: 'Payload do POST não é JSON válido.',
    }))
    // 200 mesmo assim: um 4xx/5xx faria a Meta reenviar o mesmo payload inválido
    // indefinidamente. Falha registrada; sem lógica de negócio hoje, nada é perdido.
    return NextResponse.json({ ok: true })
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(), nivel: 'info', escopo: 'webhook.whatsapp',
    msg: 'Evento recebido da Meta (WhatsApp Cloud API).', payload: corpo,
  }))

  return NextResponse.json({ ok: true })
}
