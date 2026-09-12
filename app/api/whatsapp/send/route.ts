import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { enviarTextoZapiParaLead, type CodigoErroEnvioZapi } from '@/lib/whatsapp/zapi'

export const runtime = 'nodejs'

// POST /api/whatsapp/send — envia UMA mensagem de texto ao lead pela Z-API.
//
// Coexiste com POST /api/whatsapp/enviar (Meta): rota separada, transporte
// separado. Mesmo contrato de segurança: a organização vem da SESSÃO
// (resolverAcesso → perfis.organizacao_id), nunca do corpo; o cliente manda
// só { lead_id, message }. Nesta rodada NÃO persiste nada — só valida o
// transporte Z-API.

// Erro de negócio → status HTTP, no padrão da rota da Meta.
const STATUS: Record<CodigoErroEnvioZapi, number> = {
  texto_vazio: 400,
  lead_nao_encontrado: 404,
  sem_telefone: 422,
  config_ausente: 503,
  falha_rede: 502,
  erro_provider: 502,
  resposta_invalida: 502,
}

export async function POST(req: Request) {
  // Mesma permissão do outbound atual: efeito externo real, restrito por padrão.
  const r = await exigirPermissao('campaigns.operate')
  if ('erro' in r) return r.erro
  const { admin, org } = r.acesso

  let corpo: { lead_id?: unknown; message?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const leadId = typeof corpo.lead_id === 'string' ? corpo.lead_id.trim() : ''
  const message = typeof corpo.message === 'string' ? corpo.message : ''
  if (!leadId) return NextResponse.json({ erro: 'lead_id é obrigatório.' }, { status: 400 })
  if (!message.trim()) return NextResponse.json({ erro: 'message é obrigatória.' }, { status: 400 })

  try {
    const resultado = await enviarTextoZapiParaLead(admin, { leadId, message, organizacaoId: org })
    if (!resultado.ok) {
      return NextResponse.json(
        { ok: false, erro: resultado.mensagem, codigo: resultado.codigo },
        { status: STATUS[resultado.codigo] ?? 400 },
      )
    }
    // Só os ids que a Z-API realmente devolveu. `telefone` fica fora da
    // resposta — o cliente já conhece o lead; não há por que ecoar o número.
    const { messageId, zaapId, id } = resultado
    return NextResponse.json({
      ok: true,
      provider: 'zapi',
      ...(messageId ? { messageId } : {}),
      ...(zaapId ? { zaapId } : {}),
      ...(id ? { id } : {}),
    })
  } catch (e) {
    console.error('[whatsapp/send] erro:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Falha ao enviar a mensagem.' }, { status: 500 })
  }
}
