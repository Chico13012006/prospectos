import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { getStatus } from '@/lib/whatsapp/zapi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/whatsapp/status — saúde da conexão Z-API para a Central decidir se
// libera o envio. Mesma permissão do envio (`conversations.send`): quem não
// pode enviar não precisa saber se o canal está de pé, e a UI fica coerente —
// nunca mostra "conectado" para quem receberia 403 no Enviar. Devolve SÓ
// booleanos — credenciais e instância nunca saem daqui.
//
//   conectado = connected && smartphoneConnected (os dois são necessários
//   para a mensagem chegar — ver getStatus).
export async function GET() {
  const r = await exigirPermissao('conversations.send')
  if ('erro' in r) return r.erro

  const status = await getStatus()
  if (!status.ok) {
    // Não conseguiu verificar (config ausente, rede, provider): para a UI é
    // indisponível. 200 com conectado=false — não é erro do cliente.
    return NextResponse.json({ ok: false, conectado: false, codigo: status.codigo, erro: status.mensagem })
  }
  return NextResponse.json({
    ok: true,
    conectado: status.connected && status.smartphoneConnected,
    connected: status.connected,
    smartphoneConnected: status.smartphoneConnected,
    ...(status.erro ? { erro: status.erro } : {}),
  })
}
