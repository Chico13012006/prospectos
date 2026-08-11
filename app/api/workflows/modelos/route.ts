// Catálogo de modelos de workflow (Fase 11), oferecidos como ponto de partida no
// builder. Só leitura; requer workflows.view. Não materializa nada no banco.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { MODELOS } from '@/lib/workflows/modelos'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('workflows.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }
  return NextResponse.json({
    modelos: MODELOS.map((m) => ({ chave: m.chave, nome: m.nome, descricao: m.descricao, definicao: m.definicao })),
  })
}
