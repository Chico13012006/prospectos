// MVP Renovação (Fases 4.3/4.5). Varre validades na JANELA de renovação —
// serviços recorrentes como fonte principal e leads legados como fallback —,
// cria a tarefa "Iniciar renovação", registra a
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
import { consolidarValidades, diasAteVencimento, naJanelaRenovacao } from '@/lib/servicos/vencimento'
import { log } from '@/lib/engine/logger'
type AmbienteSupabaseT = import('@/lib/workflows/ambiente').AmbienteSupabase

export interface ItemRenovacao {
  fonte: 'servico' | 'lead_legado'
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

  // Envio real só quando fora de dryRun, habilitado no config, E a trava de env liberada.
  const enviarReal = !dryRun && cfg.enviarPrimeiraMensagem && process.env.RENOVACAO_ENVIO_REAL === 'true'

  // Serviços recorrentes são a fonte principal. Durante a transição, a
  // data_validade do lead entra apenas para empresas ainda sem serviço ativo.
  const { data: servicosRows } = await db.from('servicos_recorrentes')
    .select('id, empresa_id, vencimento_em, responsavel_id')
    .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente')
    .order('id', { ascending: true })
  const { data: leadsLegadosRows } = await db.from('leads')
    .select('id, empresa_id, empresa, data_validade, responsavel_id, contato_email')
    .eq('organizacao_id', org).not('data_validade', 'is', null)
    .or('perdido.is.null,perdido.eq.false')
    .order('created_at', { ascending: true }).order('id', { ascending: true })

  const servicos = servicosRows ?? []
  const leadsLegados = leadsLegadosRows ?? []
  const validades = consolidarValidades(servicos, leadsLegados)
  const naJanela = validades.filter((v) => naJanelaRenovacao(v.vencimentoEm, cfg.antecedenciaDias, hoje))
  const servicosPorId = new Map(servicos.map((s) => [s.id, s]))
  const leadsLegadosPorId = new Map(leadsLegados.map((l) => [l.id, l]))
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

  for (const validade of naJanela) {
    const svc = validade.fonte === 'servico' ? servicosPorId.get(validade.id) ?? null : null
    let lead = validade.fonte === 'lead_legado' ? leadsLegadosPorId.get(validade.id) ?? null : null
    const empresaId = svc?.empresa_id ?? lead?.empresa_id ?? null

    let jaTemRows: { id: string }[] | null = null
    if (svc) {
      const r = await db.from('tarefas').select('id')
        .eq('organizacao_id', org).eq('servico_id', svc.id).eq('tipo', 'renovacao')
        .eq('prazo_em', `${validade.vencimentoEm}T00:00:00.000Z`).limit(1)
      jaTemRows = r.data
    } else if (lead) {
      const r = await db.from('tarefas').select('id')
        .eq('organizacao_id', org).eq('lead_id', lead.id).is('servico_id', null)
        .eq('tipo', 'renovacao').eq('prazo_em', `${validade.vencimentoEm}T00:00:00.000Z`)
        .limit(1)
      jaTemRows = r.data
    }
    const jaTem = !!(jaTemRows && jaTemRows.length > 0)

    let nomeEmp = lead?.empresa ?? '(empresa)'
    if (svc) {
      const { data: empresa } = await db.from('empresas').select('nome')
        .eq('id', svc.empresa_id).eq('organizacao_id', org).maybeSingle()
      const { data: leadRows } = await db.from('leads').select('id, empresa_id, empresa, data_validade, responsavel_id, contato_email')
        .eq('organizacao_id', org).eq('empresa_id', svc.empresa_id)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1)
      lead = leadRows?.[0] ?? null
      nomeEmp = empresa?.nome ?? lead?.empresa ?? '(empresa)'
    }
    const dias = diasAteVencimento(validade.vencimentoEm, hoje)
    // Responsável do SERVIÇO tem prioridade; senão, o do lead da empresa.
    const responsavelId = svc?.responsavel_id ?? lead?.responsavel_id ?? null

    // Destinatário da tarefa/notif = responsável (usuarios), se houver.
    let destinatarioTarefa: string | null = null
    if (responsavelId) {
      const { data: u } = await db.from('usuarios').select('nome, email').eq('id', responsavelId).eq('organizacao_id', org).maybeSingle()
      destinatarioTarefa = u?.email ?? u?.nome ?? null
    }
    itens.push({ fonte: validade.fonte, empresa: nomeEmp, vencimento: validade.vencimentoEm, dias, jaTemTarefa: jaTem, destinatarioTarefa, destinatarioMensagem: lead?.contato_email ?? null })

    if (jaTem) { duplicacoesEvitadas++; continue }

    tarefas++
    notificacoes++
    const mandaMensagem = cfg.enviarPrimeiraMensagem && !!lead
    if (mandaMensagem && enviarReal) mensagens++ // contabiliza tentativa real (provedor ainda gate por MODO_ENSAIO)

    if (dryRun) continue // relatório: não persiste nada

    const { data: tarefa } = await db.from('tarefas').insert({
      organizacao_id: org, servico_id: svc?.id ?? null, empresa_id: empresaId, lead_id: lead?.id ?? null,
      tipo: 'renovacao', titulo: `Iniciar renovação — ${nomeEmp}`,
      responsavel_id: responsavelId, prioridade: 'alta',
      prazo_em: `${validade.vencimentoEm}T00:00:00.000Z`, origem: 'renovacao',
      motivo: `Entrou na janela de renovação (vence em ${dias ?? '?'} dias; fonte: ${validade.fonte === 'servico' ? 'serviço recorrente' : 'validade legada do lead'})`,
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

  return { org, dryRun, avaliados: validades.length, naJanela: naJanela.length, tarefas, notificacoes, mensagens, duplicacoesEvitadas, itens }
}
