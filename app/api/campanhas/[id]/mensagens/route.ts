// Edição das mensagens de uma campanha já publicada (ativa ou pausada). Muda só
// o conteúdo — assunto, texto, HTML, link e o aviso ao responsável —, lido na
// hora de cada envio. Quantidade de mensagens, intervalos e a versão publicada
// ficam intactos. Regras em lib/campanhas/edicaoMensagens.ts.
import { NextResponse } from 'next/server'
import { exigirPermissao } from '@/lib/rbac/servidor'
import { buscarCampanha } from '@/lib/campanhas/repository'
import { podeUsarTipoCampanha } from '@/lib/campanhas/configuracaoGuiada'
import { editarMensagensCampanha, ErroEdicaoMensagens } from '@/lib/campanhas/edicaoMensagensServidor'

export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await exigirPermissao('campaigns.manage')
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  try {
    const campanha = await buscarCampanha(admin, org, id)
    if (!campanha) return NextResponse.json({ erro: 'Campanha não encontrada' }, { status: 404 })
    // Mesma régua de quem cria: sem `campaigns.tipos.avancados`, só comunicado.
    if (!podeUsarTipoCampanha(campanha.tipo, acc.acesso.permissoes.has('campaigns.tipos.avancados'))) {
      return NextResponse.json({ erro: 'Seu acesso permite editar apenas campanhas de comunicado.' }, { status: 403 })
    }
    const body = await req.json().catch(() => null)
    const resultado = await editarMensagensCampanha(admin, org, id, body)
    return NextResponse.json({ ok: true, ...resultado })
  } catch (e) {
    if (e instanceof ErroEdicaoMensagens) return NextResponse.json({ erro: e.message }, { status: e.status })
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Não foi possível salvar as mensagens.' }, { status: 400 })
  }
}
