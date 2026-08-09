// Relatório semanal por e-mail (sprint item 7). Resumo da semana — leads novos,
// respostas, reuniões e conversões (Ganho) — enviado 1x/semana ao Chico via o
// EmailProvider já existente (nenhuma infra de envio nova). Os números são os
// MESMOS da Inteligência Comercial, recortados pra semana. SERVER-ONLY.
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
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

  const leads = () => db.from('leads').select('id', { count: 'exact', head: true }).eq('organizacao_id', organizacaoId)
  const inter = () => db.from('interacoes').select('id', { count: 'exact', head: true }).eq('organizacao_id', organizacaoId)

  const [novos, respostas, reunioes, ganhos, total] = await Promise.all([
    leads().gte('created_at', desde),
    inter().eq('tipo', 'resposta').gte('created_at', desde),
    inter().eq('tipo', 'reuniao').gte('created_at', desde),
    leads().eq('estagio', 'ganho').gte('updated_at', desde),
    leads(),
  ])

  return {
    novos: novos.count ?? 0,
    respostas: respostas.count ?? 0,
    reunioes: reunioes.count ?? 0,
    ganhos: ganhos.count ?? 0,
    totalBase: total.count ?? 0,
    periodoInicio: ddmmaaaa(inicio),
    periodoFim: ddmmaaaa(agora),
  }
}

// Monta o e-mail (assunto + texto + HTML). PURA (testável) — recebe os KPIs.
export function montarEmailRelatorio(kpis: RelatorioKpis): { assunto: string; corpoTexto: string; corpoHtml: string } {
  const assunto = `📊 ProspectOS — resumo da semana (${kpis.periodoInicio} a ${kpis.periodoFim})`

  const linhas: [string, number][] = [
    ['Leads novos', kpis.novos],
    ['Respostas recebidas', kpis.respostas],
    ['Reuniões agendadas', kpis.reunioes],
    ['Conversões (Ganho)', kpis.ganhos],
  ]

  const corpoTexto =
    `Resumo da semana (${kpis.periodoInicio} a ${kpis.periodoFim}):\n\n` +
    linhas.map(([l, v]) => `- ${l}: ${v}`).join('\n') +
    `\n\nBase total: ${kpis.totalBase} leads.\n\n` +
    `Acompanhe o detalhe em Inteligência Comercial na plataforma.`

  const cards = linhas
    .map(
      ([l, v]) =>
        `<td style="padding:8px;"><div style="background:#0f1117;border:1px solid #2a3147;border-radius:12px;padding:16px;text-align:center;">` +
        `<div style="font-size:28px;font-weight:700;color:#e2e8f0;">${v}</div>` +
        `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">${l}</div></div></td>`,
    )
    .join('')

  const corpoHtml =
    `<div style="font-family:Arial,Helvetica,sans-serif;background:#1a1f2e;padding:24px;color:#e2e8f0;max-width:560px;margin:0 auto;border-radius:16px;">` +
    `<div style="font-weight:700;font-size:18px;">ProspectOS · InovaCode</div>` +
    `<div style="color:#94a3b8;font-size:13px;margin-top:2px;">Resumo da semana — ${kpis.periodoInicio} a ${kpis.periodoFim}</div>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:16px;"><tr>${cards}</tr></table>` +
    `<div style="color:#64748b;font-size:12px;margin-top:16px;">Base total: ${kpis.totalBase} leads. Detalhe em Inteligência Comercial.</div>` +
    `</div>`

  return { assunto, corpoTexto, corpoHtml }
}

// Gera + envia o relatório de UMA org. Best-effort: sem destinatário, só loga.
export async function enviarRelatorioSemanal(
  organizacaoId: string,
  email: EmailProvider,
): Promise<{ enviado: boolean; kpis: RelatorioKpis }> {
  const kpis = await coletarKpisSemana(organizacaoId)
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
