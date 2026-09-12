import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  interpretarDeliveryCallback,
  lerConfigWebhookZapi,
  registrarDelivery,
  validarSegredoWebhook,
} from '@/lib/whatsapp/zapiCallbacks'

export const runtime = 'nodejs'

// Webhook "Ao enviar" (DeliveryCallback) da Z-API. Rota PÚBLICA, mesmo
// contrato do /received: `?secret=` comparado em tempo constante com
// ZAPI_WEBHOOK_SECRET, instância conferida com ZAPI_INSTANCE_ID.
//
// Só anota metadata de entrega no payload de uma mensagem que JÁ existe.
// Mensagem desconhecida (anterior à integração, por exemplo) → 200 e nada
// gravado. Nunca cria mensagem, nunca resolve lead.
//
//   200 — registrado, sem alteração (duplicado/atrasado), ignorado ou órfão
//   400 — payload inválido
//   401 — segredo errado          503 — segredo/instância não configurados
//   500 — falha ao gravar (reenvio da Z-API é seguro: a aplicação é idempotente)
export async function POST(req: NextRequest) {
  const cfg = lerConfigWebhookZapi()
  if (!cfg.ok) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi.delivery', msg: `${cfg.faltando} não configurada — callback recusado.` }))
    return NextResponse.json({ erro: 'Webhook não configurado.' }, { status: 503 })
  }
  if (!validarSegredoWebhook(req.nextUrl.searchParams.get('secret'), cfg.secret)) {
    return NextResponse.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Payload não é JSON.' }, { status: 400 })
  }

  const leitura = interpretarDeliveryCallback(corpo, cfg.instanceId)
  if (leitura.tipo === 'invalido') return NextResponse.json({ erro: leitura.motivo }, { status: 400 })
  if (leitura.tipo === 'ignorar') {
    if (leitura.motivo === 'instancia_desconhecida') {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi.delivery', msg: 'Callback de instância diferente de ZAPI_INSTANCE_ID — ignorado.' }))
    }
    return NextResponse.json({ ok: true, ignorado: leitura.motivo })
  }

  const r = await registrarDelivery(createSupabaseAdminClient(), leitura.evento)
  if (r === 'erro') return NextResponse.json({ erro: 'Falha ao registrar a entrega.' }, { status: 500 })
  if (r === 'orfa') {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi.delivery', msg: 'DeliveryCallback para mensagem desconhecida — ignorado.', messageId: leitura.evento.messageId }))
  }
  return NextResponse.json({ ok: true, resultado: r })
}
