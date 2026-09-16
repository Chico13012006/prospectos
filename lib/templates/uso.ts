import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ENGINE } from '@/lib/engine/config'
import { ESTAGIOS_EM_CADENCIA } from '@/lib/engine/templates'
import { normalizarNicho } from '@/lib/nichos/normalizar'
import { referenciasDaCampanha, tiposDeTemplateNaDefinicao } from './referencias'
import type { TemplateBiblioteca, UsoTemplate } from './tipos'

// O que impede desativar um template: algo que ainda o enviaria. Toda consulta
// filtra a organização do template (service_role ignora RLS), então a resposta
// só lista workflows, campanhas e contagens da própria organização.

export type { UsoTemplate }

// Único tipo que o motor de cadência (lib/engine/mensagem.ts) usa nos follow-ups.
const TIPO_FOLLOW_UP_MOTOR = 'follow_up_1'
const LIMITE_LEADS = 5000

async function linhas<T>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

export async function buscarUsosImpeditivos(
  admin: SupabaseClient,
  org: string,
  template: Pick<TemplateBiblioteca, 'id' | 'canal' | 'tipo' | 'nicho'>,
): Promise<UsoTemplate[]> {
  // Workflows, campanhas e o motor só enviam templates de e-mail. WhatsApp,
  // LinkedIn e telefone são aplicados à mão e podem ser desativados.
  if (template.canal !== 'email') return []

  const ativos = await linhas<{ id: string; nicho: string | null }>(
    admin
      .from('templates')
      .select('id, nicho')
      .eq('organizacao_id', org)
      .eq('canal', 'email')
      .eq('tipo', template.tipo)
      .eq('ativo', true),
  )
  const outros = ativos.filter((t) => t.id !== template.id)
  // O envio usa a variante do nicho do lead e, sem ela, a genérica do mesmo tipo.
  // Se outro template assume este lugar, desativá-lo não quebra nenhum envio.
  const temSubstituto =
    outros.some((t) => t.nicho === template.nicho) ||
    (template.nicho !== null && outros.some((t) => t.nicho === null))
  if (temSubstituto) return []

  const usos: UsoTemplate[] = []
  const versoes = await linhas<{ id: string; numero: number; definicao: unknown }>(
    admin.from('workflow_versoes').select('id, numero, definicao').eq('organizacao_id', org),
  )
  const versoesQueEnviam = new Map(
    versoes.filter((v) => tiposDeTemplateNaDefinicao(v.definicao).has(template.tipo)).map((v) => [v.id, v]),
  )

  const workflowsQueEnviam = new Set<string>()
  if (versoesQueEnviam.size > 0) {
    // Pausado conta: retomar volta a enviar pela mesma versão publicada.
    const workflows = await linhas<{ id: string; nome: string; status: string; versao_atual_id: string | null }>(
      admin
        .from('workflows')
        .select('id, nome, status, versao_atual_id')
        .eq('organizacao_id', org)
        .in('status', ['publicado', 'pausado'])
        .order('nome', { ascending: true }),
    )
    for (const workflow of workflows) {
      const versao = workflow.versao_atual_id ? versoesQueEnviam.get(workflow.versao_atual_id) : undefined
      if (!versao) continue
      workflowsQueEnviam.add(workflow.id)
      usos.push({ tipo: 'workflow', id: workflow.id, nome: workflow.nome, status: workflow.status, versao: versao.numero })
    }

    // Execução fica presa à versão em que começou, inclusive versões antigas.
    const { count, error } = await admin
      .from('workflow_execucoes')
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', org)
      .in('status', ['em_andamento', 'aguardando'])
      .in('versao_id', [...versoesQueEnviam.keys()])
    if (error) throw new Error(error.message)
    if (count) usos.push({ tipo: 'execucoes', quantidade: count })
  }

  const campanhas = await linhas<{ id: string; nome: string; status: string; workflow_id: string | null; publico: unknown }>(
    admin
      .from('campanhas')
      .select('id, nome, status, workflow_id, publico')
      .eq('organizacao_id', org)
      .in('status', ['ativa', 'pausada'])
      .order('nome', { ascending: true }),
  )
  for (const campanha of campanhas) {
    const referencias = referenciasDaCampanha(campanha.publico)
    if (
      (campanha.workflow_id && workflowsQueEnviam.has(campanha.workflow_id)) ||
      referencias.ids.has(template.id) ||
      referencias.tipos.has(template.tipo)
    ) {
      usos.push({ tipo: 'campanha', id: campanha.id, nome: campanha.nome, status: campanha.status })
    }
  }

  if (template.tipo === TIPO_FOLLOW_UP_MOTOR) {
    // Mesmos filtros da seleção de follow-up do motor (SupabaseStore).
    const leads = await linhas<{ segmento: string | null }>(
      admin
        .from('leads')
        .select('segmento')
        .eq('organizacao_id', org)
        .eq('owner', OWNER_ENGINE)
        .eq('perdido', false)
        .eq('optout', false)
        .eq('bounced', false)
        .in('estagio', ESTAGIOS_EM_CADENCIA)
        .limit(LIMITE_LEADS),
    )
    const nichosComVariante = new Set(outros.map((t) => t.nicho).filter((nicho): nicho is string => !!nicho))
    const afetados = leads.filter(({ segmento }) => {
      const nicho = normalizarNicho(segmento)
      return template.nicho !== null ? nicho === template.nicho : nicho === null || !nichosComVariante.has(nicho)
    }).length
    if (afetados > 0) usos.push({ tipo: 'motor_cadencia', quantidade: afetados })
  }

  return usos
}
