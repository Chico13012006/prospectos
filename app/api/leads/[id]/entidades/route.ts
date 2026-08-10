// Read layer Empresa/Contato exposto (Fase 2e) — ADITIVO: nenhuma tela existente
// depende disto. É a primeira superfície de ativação (menor risco possível: novo
// endpoint, opt-in). Devolve a Empresa e o Contato do lead pela camada de
// compatibilidade (leads é autoritativo nos campos core; entidade nos próprios;
// N decisores da empresa). Auth por sessão + escopo de organização.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { resolverEntidadesDoLead, listarContatosDaEmpresa } from '@/lib/empresas/repository'
import { leituraEntidadesLigada } from '@/lib/empresas/flag'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org } = acc.acesso

  // Gate por organização (config tipada). Off => a tela renderiza nada novo (legado).
  if (!(await leituraEntidadesLigada(admin, org))) {
    return NextResponse.json({ ativo: false })
  }

  const ent = await resolverEntidadesDoLead(org, id)
  if (!ent) return NextResponse.json({ erro: 'Lead não encontrado' }, { status: 404 })

  // Decisores da empresa (relacionamento — só a entidade tem). Vazio no fallback legado.
  const decisores = ent.empresa.id ? await listarContatosDaEmpresa(org, ent.empresa.id) : []
  return NextResponse.json({ ativo: true, empresa: ent.empresa, contato: ent.contato, decisores })
}
