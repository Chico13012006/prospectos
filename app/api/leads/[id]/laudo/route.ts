// Laudo do lead: ciclos de validade (atual + histórico) e a ação
// "Marcar como renovado". Auth por sessão + carteira (mesmo padrão do PATCH
// do lead). A janela de alerta vem da config da organização, resolvida AQUI
// (servidor) — o cliente nunca calcula status sozinho.
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { podeAcessarLead } from '@/lib/leads/acessoServidor'
import { parseWorkspaceConfig, renovacaoEfetiva } from '@/lib/config/workspaceConfig'
import { diasAteVencimento } from '@/lib/servicos/vencimento'
import {
  dataValidadeValida,
  listarCiclos,
  renovarLaudo,
  statusLaudo,
  type CicloLaudo,
  type CicloLaudoView,
  type LaudoLeadView,
} from '@/lib/laudos/ciclos'

export const runtime = 'nodejs'

async function alertaDiasDaOrg(admin: SupabaseClient, org: string): Promise<number> {
  const { data } = await admin.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  return renovacaoEfetiva(parseWorkspaceConfig(data?.configuracoes)).alertaDias
}

function paraView(c: CicloLaudo, alertaDias: number, hoje: Date): CicloLaudoView {
  const validadeEm = String(c.validade_em).slice(0, 10)
  return {
    id: c.id,
    validadeEm,
    renovadoEm: c.renovado_em,
    status: statusLaudo(validadeEm, c.renovado_em, alertaDias, hoje),
    diasAteVencer: diasAteVencimento(validadeEm, hoje),
  }
}

async function montarView(admin: SupabaseClient, org: string, leadId: string): Promise<LaudoLeadView> {
  const [ciclos, alertaDias] = await Promise.all([
    listarCiclos(admin, org, leadId),
    alertaDiasDaOrg(admin, org),
  ])
  const hoje = new Date()
  const views = ciclos.map((c) => paraView(c, alertaDias, hoje))
  return {
    alertaDias,
    atual: views.find((v) => !v.renovadoEm) ?? null,
    historico: views.filter((v) => !!v.renovadoEm),
  }
}

// GET — ciclo atual (com status calculado) + histórico de renovações.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) {
    return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })
  }
  try {
    return NextResponse.json({ laudo: await montarView(admin, org, id) })
  } catch (erro) {
    console.error('[leads/laudo GET] erro:', erro)
    return NextResponse.json({ erro: 'Não foi possível carregar o laudo.' }, { status: 500 })
  }
}

// POST — "Marcar como renovado". Body: { novaValidade: 'AAAA-MM-DD' }. Só isso.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso
  if (!(await podeAcessarLead(acc.acesso, id))) {
    return NextResponse.json({ erro: 'Lead não encontrado.' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const novaValidade = body?.novaValidade
  if (!dataValidadeValida(novaValidade)) {
    return NextResponse.json({ erro: 'Informe a nova validade (AAAA-MM-DD).' }, { status: 400 })
  }

  try {
    const resultado = await renovarLaudo(admin, org, id, novaValidade)
    return NextResponse.json({ ok: true, ...resultado, laudo: await montarView(admin, org, id) })
  } catch (erro) {
    console.error('[leads/laudo POST] erro:', erro)
    const msg = erro instanceof Error ? erro.message : 'Não foi possível marcar como renovado.'
    return NextResponse.json({ erro: msg }, { status: 500 })
  }
}
