import { NextResponse } from 'next/server'
import { resolverAcesso } from '@/lib/rbac/servidor'
import { buscarRemetenteCampanha } from '@/lib/campanhas/opcoesServidor'
import { listarTemplates } from '@/lib/templates/repository'
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
    const [templates, { data: leads, error: leadsError }, remetente] = await Promise.all([
      // Mesma biblioteca da tela de Templates: só e-mail ativo da organização e
      // sem as cópias `campanha_*` geradas por outras campanhas.
      listarTemplates(admin, org, { canal: 'email', ativo: 'ativos' }),
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
      templates: templates.map((template) => ({
        id: template.id,
        nome: template.nome,
        tipo: template.tipo,
        assunto: template.assunto,
        corpo: template.corpo,
        html: template.html,
        formato: template.formato,
        nicho: template.nicho,
      })),
      nichos,
      testeEmailDisponivel: !!remetente && !engineConfig.modoEnsaio,
      envioRealDisponivel: !!remetente && !engineConfig.modoEnsaio,
    })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Erro' }, { status: 400 })
  }
}
