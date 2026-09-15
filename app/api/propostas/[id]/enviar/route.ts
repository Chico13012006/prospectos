import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { propostaVisivelNaSessao } from '@/lib/propostas/acessoSessao'
import { enviarProposta, type CodigoErroEnvioProposta } from '@/lib/propostas/enviarPropostaServidor'
import { depsReaisEnvioProposta } from '@/lib/propostas/canaisEnvio'

export const runtime = 'nodejs'

// POST /api/propostas/[id]/enviar — envia a proposta SALVA ao cliente, com o
// PDF anexado, por e-mail ou WhatsApp.
//
// Mesmo contrato de segurança da Central: organização da SESSÃO, nunca do
// corpo; o cliente manda só { canal, assunto?, mensagem }. A proposta precisa
// estar visível para o usuário (carteira, RLS 0045) e todas as travas — opt-out,
// bounce, perdido, MODO_ENSAIO, envio simultâneo — ficam em enviarProposta.

const STATUS: Record<CodigoErroEnvioProposta, number> = {
  canal_invalido: 400,
  mensagem_vazia: 400,
  mensagem_longa: 400,
  assunto_vazio: 400,
  proposta_nao_encontrada: 404,
  lead_nao_encontrado: 404,
  optout: 422,
  bounced: 422,
  perdido: 422,
  sem_email: 422,
  sem_telefone: 422,
  envio_em_andamento: 409,
  falha_pdf: 500,
  credencial_ausente: 503,
  config_ausente: 503,
  whatsapp_indisponivel: 503,
  falha_envio: 502,
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // `conversations.send`: a mesma permissão do envio pela Central — contato
  // direto com o lead, concedida ao comercial e ao admin.
  const r = await exigirPermissao('conversations.send')
  if ('erro' in r) return r.erro
  const { admin, org } = r.acesso
  const { id } = await params

  let corpo: { canal?: unknown; assunto?: unknown; mensagem?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  }
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })

  try {
    // CARTEIRA: a proposta precisa estar visível para a sessão.
    if (!(await propostaVisivelNaSessao(id, org))) {
      return NextResponse.json({ erro: 'Proposta não encontrada.' }, { status: 404 })
    }

    const resultado = await enviarProposta(
      admin,
      { propostaId: id, organizacaoId: org, canal: corpo.canal, assunto: corpo.assunto, mensagem: corpo.mensagem },
      depsReaisEnvioProposta(admin),
    )
    if (!resultado.ok) {
      return NextResponse.json(
        { erro: resultado.mensagem, codigo: resultado.codigo },
        { status: STATUS[resultado.codigo] ?? 400 },
      )
    }
    return NextResponse.json(resultado)
  } catch (e) {
    console.error('[propostas/enviar] erro:', e instanceof Error ? e.message : e)
    return NextResponse.json({ erro: 'Falha ao enviar a proposta.' }, { status: 500 })
  }
}
