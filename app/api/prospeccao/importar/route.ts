// Importa empresas escolhidas na busca de prospecção.
//   modo=previa    → prospeccao_importar com p_simular=true (nada é gravado)
//   modo=confirmar → grava empresa + lead + contato por CNPJ
// O lead nasce owner='n8n' / novos_leads (fora do motor), igual à importação
// por CSV. Nada é enviado. Responsável = usuário autenticado.
import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { resolverResponsavelPorAuthId } from '@/lib/leads/responsavelServer'
import { importarProspeccao, validarItens } from '@/lib/prospeccao/importacaoServidor'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  const { admin, org, user } = acc.acesso

  const corpo = (await req.json().catch(() => ({}))) as { modo?: unknown; itens?: unknown; segmento?: unknown }
  const validacao = validarItens(corpo.itens)
  if (!validacao.ok) return NextResponse.json({ erro: validacao.erro }, { status: 400 })
  const segmento = typeof corpo.segmento === 'string' ? corpo.segmento.trim().slice(0, 60) || null : null
  const simular = corpo.modo !== 'confirmar'

  try {
    let responsavel: { id: string | null; nome: string | null } = { id: null, nome: null }
    if (!simular) {
      // Mesmo bloqueio da importação por CSV: sem vínculo comercial, não cria
      // lead com responsável errado.
      const vinculo = await resolverResponsavelPorAuthId(admin, org, user.id)
      if (!vinculo.ok) {
        return NextResponse.json(
          { erro: 'Sua conta não está vinculada a um usuário comercial ativo.', motivo: vinculo.motivo },
          { status: 400 },
        )
      }
      responsavel = { id: vinculo.usuario.id, nome: vinculo.usuario.nome }
    }
    const r = await importarProspeccao(admin, { org, responsavel, segmento, itens: validacao.itens, simular })
    return NextResponse.json({ ...r, simulado: simular })
  } catch (err) {
    console.error('[prospeccao/importar] erro:', err)
    return NextResponse.json({ erro: 'Não foi possível importar agora.' }, { status: 500 })
  }
}
