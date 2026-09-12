import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { enviarEmailCentral, type CodigoErroEmail } from '@/lib/respostas/enviarEmailServidor'

export const runtime = 'nodejs'

// POST /api/email/enviar — envia UM e-mail de resposta ao lead, pela Central.
//
// Espelho de /api/whatsapp/enviar: a organização é resolvida pela SESSÃO
// (resolverAcesso → perfis.organizacao_id), nunca pelo corpo. O cliente manda
// só { leadId, assunto, texto }. O envio em si é o motor de e-mail existente
// (GmailProvider), sob a trava global MODO_ENSAIO — ver enviarEmailCentral.

const STATUS: Record<CodigoErroEmail, number> = {
  texto_vazio: 400,
  assunto_vazio: 400,
  lead_nao_encontrado: 404,
  sem_email: 422,
  optout: 422,
  bounced: 422,
  perdido: 422,
  credencial_ausente: 503,
  falha_envio: 502,
}

export async function POST(req: Request) {
  // Mesma permissão do envio de WhatsApp: efeito externo real, começa restrito.
  const r = await exigirPermissao('campaigns.operate')
  if ('erro' in r) return r.erro
  const { admin, org, user } = r.acesso

  let corpo: { leadId?: unknown; assunto?: unknown; texto?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }

  const leadId = typeof corpo.leadId === 'string' ? corpo.leadId : ''
  const assunto = typeof corpo.assunto === 'string' ? corpo.assunto : ''
  const texto = typeof corpo.texto === 'string' ? corpo.texto : ''
  if (!leadId) return NextResponse.json({ erro: 'leadId é obrigatório.' }, { status: 400 })

  try {
    const resultado = await enviarEmailCentral(admin, { leadId, assunto, texto, organizacaoId: org, usuarioId: user.id })
    if (!resultado.ok) {
      return NextResponse.json(
        { erro: resultado.mensagem, codigo: resultado.codigo },
        { status: STATUS[resultado.codigo] ?? 400 },
      )
    }
    return NextResponse.json(resultado)
  } catch (e) {
    console.error('[email/enviar] erro:', e)
    return NextResponse.json({ erro: 'Falha ao enviar o e-mail.' }, { status: 500 })
  }
}
