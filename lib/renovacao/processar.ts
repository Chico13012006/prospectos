// MVP Renovação (Fase 4.3). Varre serviços recorrentes que entraram na JANELA
// de renovação (vencimento <= hoje + antecedência) e, para cada um: cria a
// tarefa "Iniciar renovação", registra a notificação, dispara a 1ª mensagem
// (best-effort, gated por MODO_ENSAIO/simular) e registra a execução no
// histórico do lead. Idempotente: não recria tarefa de renovação aberta para o
// mesmo serviço. Multi-tenant: tudo escopado por organizacao_id.
//
// Config por workspace (organizacoes.configuracoes.renovacao): antecedência,
// template e se envia a 1ª mensagem — nada hardcoded (só defaults do produto).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { parseWorkspaceConfig, renovacaoEfetiva } from '@/lib/config/workspaceConfig'
import { diasAteVencimento } from '@/lib/servicos/vencimento'
import { log } from '@/lib/engine/logger'
// AmbienteSupabase é importado DINAMICAMENTE só no envio real (ver abaixo): seu
// grafo puxa o motor/IA (que usa 'server-only'), incompatível com execução em
// scripts/tsx. Em `simular` não há envio, então o import nunca é avaliado.
type AmbienteSupabaseT = import('@/lib/workflows/ambiente').AmbienteSupabase

export interface ResultadoRenovacao {
  org: string
  candidatos: number
  tarefasCriadas: number
  mensagens: number
  pulados: number
}

export async function processarRenovacoes(
  org: string,
  opts: { hoje?: Date; simular?: boolean; client?: SupabaseClient } = {},
): Promise<ResultadoRenovacao> {
  const db = opts.client ?? createSupabaseAdminClient()
  const hoje = opts.hoje ?? new Date()

  const { data: orgRow } = await db.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const cfg = renovacaoEfetiva(parseWorkspaceConfig(orgRow?.configuracoes))

  const limite = new Date(hoje.getTime() + cfg.antecedenciaDias * 86_400_000).toISOString().slice(0, 10)
  const { data: servicos } = await db
    .from('servicos_recorrentes')
    .select('id, empresa_id, vencimento_em')
    .eq('organizacao_id', org)
    .eq('arquivado', false)
    .eq('status', 'vigente')
    .not('vencimento_em', 'is', null)
    .lte('vencimento_em', limite)

  const candidatos = servicos ?? []
  let tarefasCriadas = 0, mensagens = 0, pulados = 0

  // Ambiente de envio criado sob demanda (lazy) — só quando for enviar de verdade.
  let ambiente: AmbienteSupabaseT | null = null
  const obterAmbiente = async (): Promise<AmbienteSupabaseT> => {
    if (!ambiente) {
      const { AmbienteSupabase } = await import('@/lib/workflows/ambiente')
      ambiente = new AmbienteSupabase(org, { simular: false, client: db })
    }
    return ambiente
  }

  for (const svc of candidatos) {
    // Idempotência: já existe tarefa de renovação aberta para este serviço?
    const { data: jaTem } = await db
      .from('tarefas').select('id')
      .eq('organizacao_id', org).eq('servico_id', svc.id).eq('tipo', 'renovacao')
      .in('status', ['aberta', 'em_andamento']).limit(1)
    if (jaTem && jaTem.length > 0) { pulados++; continue }

    const { data: empresa } = await db
      .from('empresas').select('nome').eq('id', svc.empresa_id).eq('organizacao_id', org).maybeSingle()
    const { data: leadRows } = await db
      .from('leads').select('id, responsavel_id')
      .eq('organizacao_id', org).eq('empresa_id', svc.empresa_id)
      .order('created_at', { ascending: true }).limit(1)
    const lead = leadRows?.[0] ?? null
    const dias = diasAteVencimento(svc.vencimento_em, hoje)
    const nomeEmp = empresa?.nome ?? '(empresa)'

    const { data: tarefa } = await db.from('tarefas').insert({
      organizacao_id: org,
      servico_id: svc.id,
      empresa_id: svc.empresa_id,
      lead_id: lead?.id ?? null,
      tipo: 'renovacao',
      titulo: `Iniciar renovação — ${nomeEmp}`,
      responsavel_id: lead?.responsavel_id ?? null,
      prioridade: 'alta',
      prazo_em: `${svc.vencimento_em}T00:00:00.000Z`,
      origem: 'renovacao',
      motivo: `Entrou na janela de renovação (vence em ${dias ?? '?'} dias)`,
    }).select('id').single()
    tarefasCriadas++

    await db.from('notificacoes').insert({
      organizacao_id: org,
      canal: 'app',
      titulo: `Renovação: ${nomeEmp}`,
      mensagem: `Serviço vence em ${dias ?? '?'} dias — iniciar renovação.`,
      lead_id: lead?.id ?? null,
      tarefa_id: tarefa?.id ?? null,
      origem: 'renovacao',
      motivo: 'Janela de renovação',
      link: lead ? `/leads/${lead.id}` : null,
    })

    // 1ª mensagem — best-effort. Sem template (ou erro) apenas pula; a tarefa já
    // está criada. Envio real é gated por MODO_ENSAIO (e por `simular`).
    if (cfg.enviarPrimeiraMensagem && lead && !opts.simular) {
      try {
        const r = await (await obterAmbiente()).enviarEmailTemplate(lead.id, cfg.templateTipo)
        if (r.enviado) mensagens++
      } catch (e) {
        log.aviso('Renovação: 1ª mensagem não enviada (template ausente/erro).', {
          leadId: lead.id, erro: e instanceof Error ? e.message : String(e),
        })
      }
    }

    // Execução registrada no histórico do lead (usa interacoes.motivo — auditoria).
    if (lead) {
      await db.from('interacoes').insert({
        organizacao_id: org,
        lead_id: lead.id,
        tipo: 'nota',
        canal: 'sistema',
        descricao: `Renovação iniciada: tarefa criada${cfg.enviarPrimeiraMensagem ? ' + 1ª mensagem' : ''}.`,
        origem_acao: 'ia',
        motivo: 'renovacao',
      })
    }
  }

  return { org, candidatos: candidatos.length, tarefasCriadas, mensagens, pulados }
}
