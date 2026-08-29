// MVP Renovação (Fases 4.3/4.5). Varre validades na JANELA de renovação —
// serviços recorrentes como fonte principal e leads legados como fallback —,
// cria a tarefa "Iniciar renovação", registra a notificação e inscreve o ciclo
// na campanha real de renovação ativa. O workflow versionado faz mensagem
// inicial + FUPs e é cancelado pelo detector de respostas. Idempotente e
// multi-tenant (tudo escopado por org).
//
// dryRun=true: NÃO escreve nem envia nada — só devolve o RELATÓRIO do que
// aconteceria (avaliados, na janela, tarefas/notificações/mensagens que seriam
// criadas, destinatários, duplicações evitadas). Base do relatório de ensaio.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { parseWorkspaceConfig, renovacaoEfetiva } from '@/lib/config/workspaceConfig'
import { consolidarValidades, diasAteVencimento, naJanelaRenovacao } from '@/lib/servicos/vencimento'
import { log } from '@/lib/engine/logger'
import { CadenciaRenovacaoAutomatica, alertarConfiguracaoRenovacao } from './cadenciaAutomatica'

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
  mensagens: number       // e-mails realmente enviados pelo workflow neste processamento
  duplicacoesEvitadas: number
  cadenciasIniciadas: number
  cadenciasExistentes: number
  cadenciasAgendadas: number
  falhasCadencia: number
  automacaoConfigurada: boolean
  itens: ItemRenovacao[]
}

interface LeadRenovacao {
  id: string
  empresa_id: string | null
  empresa: string
  data_validade: string | null
  responsavel_id: string | null
  contato_email: string | null
  optout?: boolean | null
  bounced?: boolean | null
  perdido?: boolean | null
}

function leadPodeReceberRenovacao(lead: LeadRenovacao | null | undefined): lead is LeadRenovacao {
  return !!lead
    && lead.optout !== true
    && lead.bounced !== true
    && lead.perdido !== true
    && typeof lead.contato_email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contato_email)
}

export async function processarRenovacoes(
  org: string,
  opts: {
    hoje?: Date
    dryRun?: boolean
    client?: SupabaseClient
    processarCadencia?: boolean
    cadencia?: Pick<CadenciaRenovacaoAutomatica, 'inscrever' | 'agendar' | 'aceitaLead' | 'limitePorLote'> | null
  } = {},
): Promise<ResultadoRenovacao> {
  const db = opts.client ?? createSupabaseAdminClient()
  const hoje = opts.hoje ?? new Date()
  const dryRun = opts.dryRun ?? false

  const { data: orgRow } = await db.from('organizacoes').select('configuracoes').eq('id', org).maybeSingle()
  const cfg = renovacaoEfetiva(parseWorkspaceConfig(orgRow?.configuracoes))

  // Serviços recorrentes são a fonte principal. Durante a transição, a
  // data_validade do lead entra apenas para empresas ainda sem serviço ativo.
  const { data: servicosRows } = await db.from('servicos_recorrentes')
    .select('id, empresa_id, vencimento_em, responsavel_id')
    .eq('organizacao_id', org).eq('arquivado', false).eq('status', 'vigente')
    .order('id', { ascending: true })
  const { data: leadsLegadosRows } = await db.from('leads')
    .select('id, empresa_id, empresa, data_validade, responsavel_id, contato_email, optout, bounced, perdido')
    .eq('organizacao_id', org).not('data_validade', 'is', null)
    .or('perdido.is.null,perdido.eq.false')
    .order('created_at', { ascending: true }).order('id', { ascending: true })

  const servicos = servicosRows ?? []
  const leadsLegados = leadsLegadosRows ?? []
  const validades = consolidarValidades(servicos, leadsLegados)
  const naJanela = validades.filter((v) => naJanelaRenovacao(v.vencimentoEm, cfg.antecedenciaDias, hoje))
  const servicosPorId = new Map(servicos.map((s) => [s.id, s]))
  const leadsLegadosPorId = new Map(leadsLegados.map((l) => [l.id, l as LeadRenovacao]))
  let tarefas = 0, notificacoes = 0, mensagens = 0, duplicacoesEvitadas = 0
  let cadenciasIniciadas = 0, cadenciasExistentes = 0, falhasCadencia = 0
  let cadenciasAgendadas = 0
  const itens: ItemRenovacao[] = []
  let cadencia: Pick<CadenciaRenovacaoAutomatica, 'inscrever' | 'agendar' | 'aceitaLead' | 'limitePorLote'> | null = null
  if (!dryRun && cfg.enviarPrimeiraMensagem && opts.processarCadencia !== false) {
    try {
      cadencia = opts.cadencia === undefined
        ? await CadenciaRenovacaoAutomatica.preparar(db, org)
        : opts.cadencia
      if (!cadencia && naJanela.length) {
        await alertarConfiguracaoRenovacao(
          db,
          org,
          'Existem vencimentos na janela, mas nenhuma campanha real de renovação está ativa.',
        )
      }
    } catch (error) {
      falhasCadencia++
      const mensagem = error instanceof Error ? error.message : String(error)
      log.aviso('Renovação automática não pôde ser preparada.', { organizacaoId: org, erro: mensagem })
      try { await alertarConfiguracaoRenovacao(db, org, mensagem) } catch { /* best-effort */ }
    }
  }
  const ciclosProcessados = new Set<string>()
  const execucoesParaAgendar: string[] = []

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
      const { data: leadRows } = await db.from('leads').select('id, empresa_id, empresa, data_validade, responsavel_id, contato_email, optout, bounced, perdido')
        .eq('organizacao_id', org).eq('empresa_id', svc.empresa_id)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(50)
      const contatos = (leadRows ?? []) as LeadRenovacao[]
      lead = contatos.find(leadPodeReceberRenovacao) ?? contatos[0] ?? null
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

    if (jaTem) duplicacoesEvitadas++
    else {
      tarefas++
      notificacoes++
      if (!dryRun) {
        const { data: tarefa } = await db.from('tarefas').insert({
          organizacao_id: org, servico_id: svc?.id ?? null, empresa_id: empresaId, lead_id: lead?.id ?? null,
          tipo: 'renovacao', titulo: `Iniciar renovação — ${nomeEmp}`,
          responsavel_id: responsavelId, prioridade: 'alta',
          prazo_em: `${validade.vencimentoEm}T00:00:00.000Z`, origem: 'renovacao',
          motivo: `Entrou na janela de renovação (vence em ${dias ?? '?'} dias; fonte: ${validade.fonte === 'servico' ? 'serviço recorrente' : 'validade legada do lead'})`,
        }).select('id').single()

        await db.from('notificacoes').insert({
          organizacao_id: org, canal: 'app', titulo: `Renovação: ${nomeEmp}`,
          mensagem: `Serviço vence em ${dias ?? '?'} dias — renovação automática iniciada.`,
          lead_id: lead?.id ?? null, tarefa_id: tarefa?.id ?? null, origem: 'renovacao',
          motivo: 'Janela de renovação', link: lead ? `/leads/${lead.id}` : null,
        })
      }
    }

    if (
      dryRun
      || !cadencia
      || !cfg.enviarPrimeiraMensagem
      || !leadPodeReceberRenovacao(lead)
      || !cadencia.aceitaLead(lead.id)
      || !validade.vencimentoEm
    ) continue
    const ciclo = `${empresaId ? `empresa:${empresaId}` : `lead:${lead.id}`}:${validade.vencimentoEm.slice(0, 7)}`
    if (ciclosProcessados.has(ciclo)) continue
    // Não cria execuções além do lote diário: os ciclos restantes continuam
    // elegíveis e serão inscritos nos próximos crons, já com a mesma chave.
    if (execucoesParaAgendar.length >= cadencia.limitePorLote) continue
    ciclosProcessados.add(ciclo)
    try {
      // A resposta só pode ser detectada pelo motor para leads explicitamente
      // sob sua responsabilidade. O gate acima impede opt-out/bounce/perdido de
      // voltar à esteira por uma mudança incidental de owner.
      const { data: leadLiberado, error: ownerError } = await db.from('leads')
        .update({ owner: 'engine' })
        .eq('organizacao_id', org)
        .eq('id', lead.id)
        .eq('optout', false)
        .eq('bounced', false)
        .or('perdido.is.null,perdido.eq.false')
        .select('id')
        .maybeSingle()
      if (ownerError) throw ownerError
      if (!leadLiberado) throw new Error('O contato deixou de ser elegível antes do início da renovação.')
      const resultado = await cadencia.inscrever({
        leadId: lead.id,
        empresaId,
        servicoId: svc?.id ?? null,
        vencimento: validade.vencimentoEm,
      })
      if (resultado.jaInscrito) cadenciasExistentes++
      else cadenciasIniciadas++
      if (resultado.precisaAgendar) execucoesParaAgendar.push(resultado.execucaoId)
      if (!resultado.jaInscrito) {
        await db.from('interacoes').insert({
          organizacao_id: org, lead_id: lead.id, tipo: 'nota', canal: 'sistema',
          descricao: `Renovação automática iniciada para o vencimento de ${validade.vencimentoEm}.`,
          origem_acao: 'ia', motivo: 'renovacao',
        })
      }
    } catch (error) {
      falhasCadencia++
      const mensagem = error instanceof Error ? error.message : String(error)
      log.aviso('Falha ao iniciar/processar cadência de renovação.', {
        organizacaoId: org,
        leadId: lead.id,
        erro: mensagem,
      })
      try { await alertarConfiguracaoRenovacao(db, org, mensagem) } catch { /* best-effort */ }
    }
  }

  if (cadencia && execucoesParaAgendar.length) {
    try {
      const agenda = await cadencia.agendar(execucoesParaAgendar)
      cadenciasAgendadas = agenda.agendadas
    } catch (error) {
      falhasCadencia += execucoesParaAgendar.length
      const mensagem = error instanceof Error ? error.message : String(error)
      log.aviso('Falha ao agendar os e-mails da renovação automática.', { organizacaoId: org, erro: mensagem })
      try { await alertarConfiguracaoRenovacao(db, org, mensagem) } catch { /* best-effort */ }
    }
  }

  return {
    org,
    dryRun,
    avaliados: validades.length,
    naJanela: naJanela.length,
    tarefas,
    notificacoes,
    mensagens,
    duplicacoesEvitadas,
    cadenciasIniciadas,
    cadenciasExistentes,
    cadenciasAgendadas,
    falhasCadencia,
    automacaoConfigurada: !!cadencia,
    itens,
  }
}
