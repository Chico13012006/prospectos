import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { enviarTextoWhatsapp, type CodigoErroEnvio } from '@/lib/whatsapp/outbound'

export const runtime = 'nodejs'

// POST /api/whatsapp/enviar — envia UMA mensagem de texto para o lead.
//
// Esta rota existe para que a organização seja resolvida pela SESSÃO
// (resolverAcesso → perfis.organizacao_id) e nunca pelo corpo do pedido. O
// cliente manda apenas { leadId, texto }; qualquer `organizacao_id` que viesse
// no payload seria ignorado.
//
// Nada dispara sozinho: só envia quando alguém chama esta rota, e mesmo assim
// WHATSAPP_MODO_ENSAIO=true (padrão) simula. Essa trava é só deste canal — o
// MODO_ENSAIO global do motor de e-mail não interfere aqui nem é afetado.
// Nenhuma tela chama isto ainda — o botão Enviar da Central segue desabilitado.

// Erro de negócio → status HTTP. 'falha_meta' é 502: a falha é do lado de lá.
const STATUS: Record<CodigoErroEnvio, number> = {
  texto_vazio: 400,
  lead_nao_encontrado: 404,
  sem_telefone: 422,
  fora_da_janela: 422,
  config_ausente: 503,
  falha_meta: 502,
  falha_registro: 500,
}

export async function POST(req: Request) {
  // `campaigns.operate` é a permissão de operar envio já existente (admin por
  // padrão). Enviar WhatsApp é efeito externo real — começa restrito.
  const r = await exigirPermissao('campaigns.operate')
  if ('erro' in r) return r.erro
  const { admin, org } = r.acesso

  let corpo: { leadId?: unknown; texto?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const leadId = typeof corpo.leadId === 'string' ? corpo.leadId : ''
  const texto = typeof corpo.texto === 'string' ? corpo.texto : ''
  if (!leadId) return NextResponse.json({ erro: 'leadId é obrigatório.' }, { status: 400 })

  try {
    // organizacaoId vem da sessão — ver comentário do topo.
    const resultado = await enviarTextoWhatsapp(admin, { leadId, texto, organizacaoId: org })
    if (!resultado.ok) {
      return NextResponse.json(
        { erro: resultado.mensagem, codigo: resultado.codigo },
        { status: STATUS[resultado.codigo] ?? 400 },
      )
    }
    return NextResponse.json(resultado)
  } catch (e) {
    console.error('[whatsapp/enviar] erro:', e)
    return NextResponse.json({ erro: 'Falha ao enviar a mensagem.' }, { status: 500 })
  }
}
