import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  interpretarMessageStatusCallback,
  lerConfigWebhookZapi,
  registrarStatus,
  validarSegredoWebhook,
} from '@/lib/whatsapp/zapiCallbacks'

export const runtime = 'nodejs'

// Webhook "Ao atualizar status da mensagem" (MessageStatusCallback) da Z-API.
// Rota PÚBLICA, mesmo contrato do /received e do /delivery.
//
// Um callback traz `ids` (array) + um `status` (SENT | RECEIVED | READ |
// READ_BY_ME | PLAYED). Cada id é atualizado à parte; id desconhecido → ignorado
// (200). Ordem por tempo do callback — status atrasado não rebaixa.
//
//   200 — processado (por id: atualizada / sem_alteracao / orfa) ou ignorado
//   400 — payload inválido        401 — segredo errado
//   503 — não configurado         500 — algum id falhou ao gravar (reenvio é seguro)
export async function POST(req: NextRequest) {
  const cfg = lerConfigWebhookZapi()
  if (!cfg.ok) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), nivel: 'erro', escopo: 'webhook.zapi.status', msg: `${cfg.faltando} não configurada — callback recusado.` }))
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

  const leitura = interpretarMessageStatusCallback(corpo, cfg.instanceId)
  if (leitura.tipo === 'invalido') return NextResponse.json({ erro: leitura.motivo }, { status: 400 })
  if (leitura.tipo === 'ignorar') {
    if (leitura.motivo === 'instancia_desconhecida') {
      console.warn(JSON.stringify({ ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi.status', msg: 'Callback de instância diferente de ZAPI_INSTANCE_ID — ignorado.' }))
    }
    return NextResponse.json({ ok: true, ignorado: leitura.motivo })
  }

  const porId = await registrarStatus(createSupabaseAdminClient(), leitura.evento)
  const resultados = Object.values(porId)
  if (resultados.includes('erro')) {
    return NextResponse.json({ erro: 'Falha ao registrar status de uma ou mais mensagens.', porId }, { status: 500 })
  }
  const orfas = Object.keys(porId).filter((id) => porId[id] === 'orfa')
  if (orfas.length) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), nivel: 'aviso', escopo: 'webhook.zapi.status', msg: 'MessageStatusCallback para mensagem(ns) desconhecida(s) — ignorado.', ids: orfas }))
  }
  return NextResponse.json({ ok: true, status: leitura.evento.status, porId })
}
