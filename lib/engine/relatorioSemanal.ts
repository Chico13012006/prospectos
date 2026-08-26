// Relatório semanal por e-mail. Compõe uma seção por objetivo operacional ativo
// (prospecção e/ou vencimento de laudos), usando os mesmos consolidadores do
// dashboard. Reaproveita o EmailProvider existente. SERVER-ONLY.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { operacaoEfetiva, parseWorkspaceConfig, type ObjetivoOperacional } from '@/lib/config/workspaceConfig'
import { consolidarValidades, resumirValidades } from '@/lib/servicos/vencimento'
import type { EmailProvider } from './email/provider'
import { log } from './logger'

// Destinatário: RELATORIO_EMAIL (dedicado, opcional) → ALERT_EMAIL (item 2.5) →
// conta remetente. Reaproveita o que já está configurado.
function destinatario(): string | null {
  return process.env.RELATORIO_EMAIL || process.env.ALERT_EMAIL || process.env.GMAIL_USER || null
}

export interface RelatorioKpis {
  novos: number       // leads criados na semana
  respostas: number   // interações tipo=resposta na semana
  reunioes: number    // interações tipo=reuniao na semana
  ganhos: number      // leads que viraram 'ganho' na semana (updated_at)
  totalBase: number   // total de leads na base (contexto)
  periodoInicio: string // dd/mm/aaaa
  periodoFim: string
  objetivosAtivos?: ObjetivoOperacional[]
  relatorioSemanalHabilitado?: boolean
  vencimentos?: {
    vencidos: number
    proximos30: number
    proximos60: number
    totalMonitorado: number
    renovadosSemana: number
  }
}

function ddmmaaaa(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

// Coleta os KPIs da última semana para UMA organização (service_role + filtro por
// organizacao_id — mesma trava dos outros caminhos do motor). Usa COUNT head
// (não traz linhas) — barato mesmo com a base cheia.
export async function coletarKpisSemana(organizacaoId: string, agora = new Date()): Promise<RelatorioKpis> {
  const db = createSupabaseAdminClient()
  const inicio = new Date(agora)
  inicio.setUTCDate(inicio.getUTCDate() - 7)
  inicio.setUTCHours(0, 0, 0, 0)
  const desde = inicio.toISOString()

  const { data: orgRow, error: orgErro } = await db.from('organizacoes')
    .select('configuracoes').eq('id', organizacaoId).maybeSingle()
  if (orgErro) throw orgErro
  const operacao = operacaoEfetiva(parseWorkspaceConfig(orgRow?.configuracoes))

  const leads = () => db.from('leads').select('id', { count: 'exact', head: true }).eq('organizacao_id', organizacaoId)
  const inter = () => db.from('interacoes').select('id', { count: 'exact', head: true }).eq('organizacao_id', organizacaoId)

  const [novos, respostas, reunioes, ganhos, total] = await Promise.all([
    leads().gte('created_at', desde),
    inter().eq('tipo', 'resposta').gte('created_at', desde),
    inter().eq('tipo', 'reuniao').gte('created_at', desde),
    leads().eq('estagio', 'ganho').gte('updated_at', desde),
    leads(),
  ])

  const kpis: RelatorioKpis = {
    novos: novos.count ?? 0,
    respostas: respostas.count ?? 0,
    reunioes: reunioes.count ?? 0,
    ganhos: ganhos.count ?? 0,
    totalBase: total.count ?? 0,
    periodoInicio: ddmmaaaa(inicio),
    periodoFim: ddmmaaaa(agora),
    objetivosAtivos: operacao.objetivosAtivos,
    relatorioSemanalHabilitado: operacao.relatorioSemanal,
  }

  if (operacao.objetivosAtivos.includes('vencimentos_laudos')) {
    const [servicos, legados, renovados] = await Promise.all([
      db.from('servicos_recorrentes').select('id, empresa_id, vencimento_em')
        .eq('organizacao_id', organizacaoId).eq('arquivado', false).eq('status', 'vigente')
        .order('id', { ascending: true }),
      db.from('leads').select('id, empresa_id, data_validade')
        .eq('organizacao_id', organizacaoId).not('data_validade', 'is', null)
        .order('created_at', { ascending: true }).order('id', { ascending: true }),
      db.from('servicos_recorrentes').select('id', { count: 'exact', head: true })
        .eq('organizacao_id', organizacaoId).eq('status', 'renovado').gte('atualizado_em', desde),
    ])
    if (servicos.error) throw servicos.error
    if (legados.error) throw legados.error
    if (renovados.error) throw renovados.error
    const resumo = resumirValidades(consolidarValidades(servicos.data ?? [], legados.data ?? []), agora)
    kpis.vencimentos = {
      vencidos: resumo.vencidos,
      proximos30: resumo.proximos30,
      proximos60: resumo.proximos60,
      totalMonitorado: resumo.totalComData,
      renovadosSemana: renovados.count ?? 0,
    }
  }

  return kpis
}

// Monta o e-mail (assunto + texto + HTML). PURA (testável) — recebe os KPIs.
export function montarEmailRelatorio(kpis: RelatorioKpis): { assunto: string; corpoTexto: string; corpoHtml: string } {
  const assunto = `📊 ProspectOS — resumo da semana (${kpis.periodoInicio} a ${kpis.periodoFim})`

  const objetivos = kpis.objetivosAtivos?.length ? kpis.objetivosAtivos : ['prospeccao']

  const linhas: [string, number][] = [
    ['Leads novos', kpis.novos],
    ['Respostas recebidas', kpis.respostas],
    ['Reuniões agendadas', kpis.reunioes],
    ['Conversões (Ganho)', kpis.ganhos],
  ]

  const secoesTexto: string[] = []
  if (objetivos.includes('prospeccao')) {
    secoesTexto.push(`PROSPECÇÃO\n${linhas.map(([l, v]) => `- ${l}: ${v}`).join('\n')}\n- Base total: ${kpis.totalBase} leads`)
  }
  if (objetivos.includes('vencimentos_laudos') && kpis.vencimentos) {
    secoesTexto.push(
      `VENCIMENTO DE LAUDOS\n` +
      `- Vencidos: ${kpis.vencimentos.vencidos}\n` +
      `- Vencendo em 30 dias: ${kpis.vencimentos.proximos30}\n` +
      `- Vencendo em 60 dias: ${kpis.vencimentos.proximos60}\n` +
      `- Renovados na semana: ${kpis.vencimentos.renovadosSemana}\n` +
      `- Total monitorado: ${kpis.vencimentos.totalMonitorado}`,
    )
  }

  const corpoTexto =
    `Resumo da semana (${kpis.periodoInicio} a ${kpis.periodoFim}):\n\n` +
    secoesTexto.join('\n\n') +
    `\n\nAcompanhe os clientes que precisam de ação no Painel de Controle.`

  const cardsProspeccao = linhas
    .map(
      ([l, v]) =>
        `<td style="padding:8px;"><div style="background:#0f1117;border:1px solid #2a3147;border-radius:12px;padding:16px;text-align:center;">` +
        `<div style="font-size:28px;font-weight:700;color:#e2e8f0;">${v}</div>` +
        `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">${l}</div></div></td>`,
    )
    .join('')

  const cardsVencimentos = kpis.vencimentos
    ? ([
        ['Laudos vencidos', kpis.vencimentos.vencidos],
        ['Vencem em 30 dias', kpis.vencimentos.proximos30],
        ['Renovados na semana', kpis.vencimentos.renovadosSemana],
      ] as [string, number][]).map(
        ([l, v]) =>
          `<td style="padding:8px;"><div style="background:#0f1117;border:1px solid #2a3147;border-radius:12px;padding:16px;text-align:center;">` +
          `<div style="font-size:28px;font-weight:700;color:#e2e8f0;">${v}</div>` +
          `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">${l}</div></div></td>`,
      ).join('')
    : ''

  const secoesHtml = [
    objetivos.includes('prospeccao')
      ? `<div style="font-size:13px;font-weight:700;color:#a5b4fc;margin-top:18px;">PROSPECÇÃO</div><table style="width:100%;border-collapse:collapse;"><tr>${cardsProspeccao}</tr></table><div style="color:#64748b;font-size:12px;margin-top:8px;">Base total: ${kpis.totalBase} leads.</div>`
      : '',
    objetivos.includes('vencimentos_laudos') && cardsVencimentos
      ? `<div style="font-size:13px;font-weight:700;color:#67e8f9;margin-top:18px;">VENCIMENTO DE LAUDOS</div><table style="width:100%;border-collapse:collapse;"><tr>${cardsVencimentos}</tr></table><div style="color:#64748b;font-size:12px;margin-top:8px;">Total monitorado: ${kpis.vencimentos?.totalMonitorado ?? 0} laudos.</div>`
      : '',
  ].join('')

  const corpoHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;background:#1a1f2e;padding:24px;color:#e2e8f0;max-width:560px;margin:0 auto;border-radius:16px;">` +
    `<div style="font-weight:700;font-size:18px;">ProspectOS · InovaCode</div>` +
    `<div style="color:#94a3b8;font-size:13px;margin-top:2px;">Resumo da semana — ${kpis.periodoInicio} a ${kpis.periodoFim}</div>` +
    secoesHtml +
    `<div style="color:#64748b;font-size:12px;margin-top:16px;">Acompanhe os clientes que precisam de ação no Painel de Controle.</div>` +
    `</div>`

  return { assunto, corpoTexto, corpoHtml }
}

// Gera + envia o relatório de UMA org. Best-effort: sem destinatário, só loga.
export async function enviarRelatorioSemanal(
  organizacaoId: string,
  email: EmailProvider,
): Promise<{ enviado: boolean; kpis: RelatorioKpis }> {
  const kpis = await coletarKpisSemana(organizacaoId)
  if (kpis.relatorioSemanalHabilitado === false) {
    log.info('Relatório semanal desativado nas configurações da organização.', { organizacaoId })
    return { enviado: false, kpis }
  }
  const dest = destinatario()
  if (!dest) {
    log.aviso('Relatório semanal gerado, mas sem destinatário (RELATORIO_EMAIL/ALERT_EMAIL/GMAIL_USER).', { organizacaoId })
    return { enviado: false, kpis }
  }
  const { assunto, corpoTexto, corpoHtml } = montarEmailRelatorio(kpis)
  await email.enviar(dest, assunto, corpoTexto, corpoHtml)
  log.ok('Relatório semanal enviado.', { organizacaoId, destino: dest, ...kpis })
  return { enviado: true, kpis }
}
