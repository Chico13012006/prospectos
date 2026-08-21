import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarRemetenteCampanha } from '@/lib/campanhas/opcoesServidor'
import { engineConfig } from '@/lib/engine/config'

export const runtime = 'nodejs'

export async function GET() {
  const acc = await resolverAcesso()
  if ('erro' in acc) return acc.erro
  if (!acc.acesso.permissoes.has('campaigns.view')) {
    return NextResponse.json({ erro: 'Sem permissão' }, { status: 403 })
  }

  const { admin, org } = acc.acesso
  try {
    const [{ data: templates, error }, { data: leads, error: leadsError }, remetente] = await Promise.all([
      admin
        .from('templates')
        .select('id, nome, tipo, assunto, corpo, nicho')
        .eq('organizacao_id', org)
        .eq('canal', 'email')
        .eq('ativo', true)
        .order('nome', { ascending: true })
        .limit(200),
      admin
        .from('leads')
        .select('segmento')
        .eq('organizacao_id', org)
        .not('segmento', 'is', null)
        .neq('segmento', '')
        .order('segmento', { ascending: true })
        .limit(2000),
      buscarRemetenteCampanha(admin, org),
    ])
    if (error) throw error
    if (leadsError) throw leadsError
    const nichosPorChave = new Map<string, string>()
    for (const lead of leads ?? []) {
      const nicho = typeof lead.segmento === 'string' ? lead.segmento.trim() : ''
      if (nicho && !nichosPorChave.has(nicho.toLocaleLowerCase('pt-BR'))) {
        nichosPorChave.set(nicho.toLocaleLowerCase('pt-BR'), nicho)
      }
    }
    const nichos = [...nichosPorChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return NextResponse.json({
      remetente,
      templates: templates ?? [],
      nichos,
      testeEmailDisponivel: !!remetente && !engineConfig.modoEnsaio,
    })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
