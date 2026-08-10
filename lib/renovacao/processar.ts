// MVP Renovação (Fases 4.3/4.5). Varre serviços recorrentes na JANELA de
// renovação e, por serviço: cria a tarefa "Iniciar renovação", registra a
// notificação, (opcionalmente) dispara a 1ª mensagem e registra a execução no
// histórico do lead. Idempotente. Multi-tenant (tudo escopado por org).
//
// DUAS travas de segurança de envio:
//   - MODO_ENSAIO (provedor): em ensaio o Gmail só loga.
//   - RENOVACAO_ENVIO_REAL (env, default OFF): mesmo fora de ensaio, a renovação
//     SÓ envia e-mail quando esta env = 'true'. Assim o cron pode rodar diário
//     criando tarefas/notificações SEM mandar e-mail até a liberação explícita.
//
// dryRun=true: NÃO escreve nem envia nada — só devolve o RELATÓRIO do que
// aconteceria (avaliados, na janela, tarefas/notificações/mensagens que seriam
// criadas, destinatários, duplicações evitadas). Base do relatório de ensaio.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { parseWorkspaceConfig, renovacaoEfetiva } from '@/lib/config/workspaceConfig'
import { diasAteVencimento } from '@/lib/servicos/vencimento'
import { log } from '@/lib/engine/logger'
type AmbienteSupabaseT = import('@/lib/workflows/ambiente').AmbienteSupabase

export interface ItemRenovacao {
  empresa: string
  vencimento: string | null
  dias: number | null
  jaTemTarefa: boolean
  destinatarioTarefa: string | null   // responsável (nome/e-mail) — quem recebe a tarefa/notif
  destinatarioMensagem: string | null // e-mail do contato — quem receberia a 1ª mensagem
}

export interface ResultadoRenovacao {
  org: string
  dryRun: boolean
  avaliados: number
  naJanela: number
  tarefas: number         // criadas (ou que seriam criadas, em dryRun)
  notificacoes: number
  mensagens: number       // enviadas de verdade (0 em dryRun ou sem RENOVACAO_ENVIO_REAL)
  duplicacoesEvitadas: number
  itens: ItemRenovacao[]
}

export async function processarRenovacoes(
  org: string,
  opts: { hoje?: Date; dryRun?: boolean; client?: SupabaseClient } = {},
): Promise<ResultadoRenovacao> {
  const db = opts.client ?? createSupabaseAdminClient()
  const hoje = opts.hoje ?? new Date()
  const dryRun = opts.dryRun ?? false

  const { data: orgRow } = await db.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const cfg = renovacaoEfetiva(parseWorkspaceConfig(orgRow?.configuracoes))
  const limite = new Date(hoje.getTime() + cfg.antecedenciaDias * 86_400_000).toISOString().slice(0, 10)

  // Envio real só quando fora de dryRun, habilitado no config, E a trava de env liberada.
  const enviarReal = !dryRun && cfg.enviarPrimeiraMensagem && process.env.RENOVACAO_ENVIO_REAL === 'true'

  // Avaliados: serviços elegíveis (ativos, vigentes, com vencimento).
  const { count: avaliados } = await db.from('servicos_recorrentes')
    .select('id', { count: 'exact', head: true })
    .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente').not('vencimento_em', 'is', null)

  // Na janela: vencimento <= hoje + antecedência.
  const { data: naJanelaRows } = await db.from('servicos_recorrentes')
    .select('id, empresa_id, vencimento_em, responsavel_id')
    .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente')
    .not('vencimento_em', 'is', null).lte('vencimento_em', limite)

  const naJanela = naJanelaRows ?? []
  let tarefas = 0, notificacoes = 0, mensagens = 0, duplicacoesEvitadas = 0
  const itens: ItemRenovacao[] = []

  let ambiente: AmbienteSupabaseT | null = null
  const obterAmbiente = async (): Promise<AmbienteSupabaseT> => {
    if (!ambiente) {
      const { AmbienteSupabase } = await import('@/lib/workflows/ambiente')
      ambiente = new AmbienteSupabase(org, { simular: false, client: db })
    }
    return ambiente
  }

  for (const svc of naJanela) {
    const { data: jaTemRows } = await db.from('tarefas').select('id')
      .eq('organizacao_id', org).eq('servico_id', svc.id).eq('tipo', 'renovacao')
      .in('status', ['aberta', 'em_andamento']).limit(1)
    const jaTem = !!(jaTemRows && jaTemRows.length > 0)

    const { data: empresa } = await db.from('empresas').select('nome').eq('id', svc.empresa_id).eq('organizacao_id', org).maybeSingle()
    const { data: leadRows } = await db.from('leads').select('id, responsavel_id, contato_email')
      .eq('organizacao_id', org).eq('empresa_id', svc.empresa_id).order('created_at', { ascending: true }).limit(1)
    const lead = leadRows?.[0] ?? null
    const dias = diasAteVencimento(svc.vencimento_em, hoje)
    const nomeEmp = empresa?.nome ?? '(empresa)'
    // Responsável do SERVIÇO tem prioridade; senão, o do lead da empresa.
    const responsavelId = svc.responsavel_id ?? lead?.responsavel_id ?? null

    // Destinatário da tarefa/notif = responsável (usuarios), se houver.
    let destinatarioTarefa: string | null = null
    if (responsavelId) {
      const { data: u } = await db.from('usuarios').select('nome, email').eq('id', responsavelId).eq('organizacao_id', org).maybeSingle()
      destinatarioTarefa = u?.email ?? u?.nome ?? null
    }
    itens.push({ empresa: nomeEmp, vencimento: svc.vencimento_em, dias, jaTemTarefa: jaTem, destinatarioTarefa, destinatarioMensagem: lead?.contato_email ?? null })

    if (jaTem) { duplicacoesEvitadas++; continue }

    tarefas++
    notificacoes++
    const mandaMensagem = cfg.enviarPrimeiraMensagem && !!lead
    if (mandaMensagem && enviarReal) mensagens++ // contabiliza tentativa real (provedor ainda gate por MODO_ENSAIO)

    if (dryRun) continue // relatório: não persiste nada

    const { data: tarefa } = await db.from('tarefas').insert({
      organizacao_id: org, servico_id: svc.id, empresa_id: svc.empresa_id, lead_id: lead?.id ?? null,
      tipo: 'renovacao', titulo: `Iniciar renovação — ${nomeEmp}`,
      responsavel_id: responsavelId, prioridade: 'alta',
      prazo_em: `${svc.vencimento_em}T00:00:00.000Z`, origem: 'renovacao',
      motivo: `Entrou na janela de renovação (vence em ${dias ?? '?'} dias)`,
    }).select('id').single()

    await db.from('notificacoes').insert({
      organizacao_id: org, canal: 'app', titulo: `Renovação: ${nomeEmp}`,
      mensagem: `Serviço vence em ${dias ?? '?'} dias — iniciar renovação.`,
      lead_id: lead?.id ?? null, tarefa_id: tarefa?.id ?? null, origem: 'renovacao',
      motivo: 'Janela de renovação', link: lead ? `/leads/${lead.id}` : null,
    })

    let enviou = false
    if (mandaMensagem && enviarReal && lead) {
      try {
        const r = await (await obterAmbiente()).enviarEmailTemplate(lead.id, cfg.templateTipo)
        enviou = r.enviado
      } catch (e) {
        log.aviso('Renovação: 1ª mensagem não enviada (template ausente/erro).', { leadId: lead.id, erro: e instanceof Error ? e.message : String(e) })
      }
    }

    if (lead) {
      await db.from('interacoes').insert({
        organizacao_id: org, lead_id: lead.id, tipo: 'nota', canal: 'sistema',
        descricao: `Renovação iniciada: tarefa criada${enviou ? ' + 1ª mensagem enviada' : (mandaMensagem ? ' (mensagem em ensaio — não enviada)' : '')}.`,
        origem_acao: 'ia', motivo: 'renovacao',
      })
    }
  }

  return { org, dryRun, avaliados: avaliados ?? 0, naJanela: naJanela.length, tarefas, notificacoes, mensagens, duplicacoesEvitadas, itens }
}
