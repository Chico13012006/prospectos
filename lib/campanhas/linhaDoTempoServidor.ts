import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Linha do tempo REAL de uma campanha: quem recebeu, quando saiu, quem respondeu
// e quando o closer foi avisado. Só compõe o que já está persistido — execuções,
// eventos de execução e interações do lead. Nada é estimado: destinatário sem
// evento de envio aparece como pendente/falho, não como "enviado".
//
// Atribuição de resposta: uma interação só conta para esta campanha se veio
// DEPOIS do início da execução daquele lead. É o mesmo critério de
// `resumoExecucoesServidor`, e evita que conversa anterior seja creditada aqui.

export type TipoEventoDestinatario =
  | 'enviado'
  | 'nao_enviado'
  | 'resposta'
  | 'closer'
  | 'erro'
  | 'cancelado'

export interface EventoDestinatario {
  tipo: TipoEventoDestinatario
  em: string
  detalhe?: string | null
}

export interface DestinatarioCampanha {
  execucaoId: string
  leadId: string | null
  empresa: string
  contato: string | null
  email: string | null
  statusExecucao: string
  iniciadoEm: string
  enviadoEm: string | null
  respondeuEm: string | null
  closerAvisadoEm: string | null
  eventos: EventoDestinatario[]
}

export interface TotaisLinhaDoTempo {
  publico: number
  enviados: number
  respostas: number
  falhas: number
  pendentes: number
}

export interface LinhaDoTempoCampanha {
  destinatarios: DestinatarioCampanha[]
  totais: TotaisLinhaDoTempo
}

// O encaminhamento ao closer é gravado como nota de sistema — não existe um
// `tipo` próprio na tabela. Reconhecemos pelo prefixo que o motor escreve.
const PREFIXO_CLOSER = 'Encaminhado ao closer'

interface ExecucaoRow {
  id: string
  lead_id: string | null
  status: string
  iniciado_em: string
}
interface LeadRow {
  id: string
  empresa: string | null
  contato_nome: string | null
  contato_email: string | null
}
interface EventoRow {
  execucao_id: string
  tipo: string
  detalhe: Record<string, unknown> | null
  criado_em: string
}
interface InteracaoRow {
  lead_id: string
  tipo: string
  descricao: string | null
  created_at: string
}

const totaisVazios = (): TotaisLinhaDoTempo => ({
  publico: 0, enviados: 0, respostas: 0, falhas: 0, pendentes: 0,
})

export async function buscarLinhaDoTempoCampanha(
  admin: SupabaseClient,
  organizacaoId: string,
  campanhaId: string,
): Promise<LinhaDoTempoCampanha> {
  const { data: execucoesRaw, error: erroExecucoes } = await admin
    .from('workflow_execucoes')
    .select('id, lead_id, status, iniciado_em')
    .eq('organizacao_id', organizacaoId)
    .eq('campanha_id', campanhaId)
    .order('iniciado_em', { ascending: true })
  if (erroExecucoes) throw erroExecucoes

  const execucoes = (execucoesRaw ?? []) as ExecucaoRow[]
  if (!execucoes.length) return { destinatarios: [], totais: totaisVazios() }

  const leadIds = [...new Set(execucoes.map((e) => e.lead_id).filter((id): id is string => !!id))]
  const execucaoIds = execucoes.map((e) => e.id)

  const leads = new Map<string, LeadRow>()
  if (leadIds.length) {
    const { data, error } = await admin
      .from('leads')
      .select('id, empresa, contato_nome, contato_email')
      .eq('organizacao_id', organizacaoId)
      .in('id', leadIds)
    if (error) throw error
    for (const lead of (data ?? []) as LeadRow[]) leads.set(lead.id, lead)
  }

  const eventosPorExecucao = new Map<string, EventoRow[]>()
  {
    const { data, error } = await admin
      .from('workflow_execucao_eventos')
      .select('execucao_id, tipo, detalhe, criado_em')
      .eq('organizacao_id', organizacaoId)
      .in('execucao_id', execucaoIds)
      .order('criado_em', { ascending: true })
    if (error) throw error
    for (const evento of (data ?? []) as EventoRow[]) {
      const lista = eventosPorExecucao.get(evento.execucao_id) ?? []
      lista.push(evento)
      eventosPorExecucao.set(evento.execucao_id, lista)
    }
  }

  // Interações a partir do início mais antigo entre as execuções desta campanha.
  // O recorte por lead acontece depois, contra o início da execução daquele lead.
  const interacoesPorLead = new Map<string, InteracaoRow[]>()
  const inicioGlobal = execucoes.map((e) => e.iniciado_em).sort()[0]
  if (leadIds.length && inicioGlobal) {
    const { data, error } = await admin
      .from('interacoes')
      .select('lead_id, tipo, descricao, created_at')
      .eq('organizacao_id', organizacaoId)
      .in('lead_id', leadIds)
      .in('tipo', ['resposta', 'nota'])
      .gte('created_at', inicioGlobal)
      .order('created_at', { ascending: true })
    if (error) throw error
    for (const interacao of (data ?? []) as InteracaoRow[]) {
      const lista = interacoesPorLead.get(interacao.lead_id) ?? []
      lista.push(interacao)
      interacoesPorLead.set(interacao.lead_id, lista)
    }
  }

  const destinatarios: DestinatarioCampanha[] = execucoes.map((execucao) => {
    const lead = execucao.lead_id ? leads.get(execucao.lead_id) : undefined
    const eventos: EventoDestinatario[] = []

    let enviadoEm: string | null = null
    for (const evento of eventosPorExecucao.get(execucao.id) ?? []) {
      if (evento.tipo === 'email_enviado') {
        const enviado = evento.detalhe?.enviado === true
        const assunto = typeof evento.detalhe?.assunto === 'string' ? evento.detalhe.assunto : null
        if (enviado && !enviadoEm) enviadoEm = evento.criado_em
        eventos.push({
          tipo: enviado ? 'enviado' : 'nao_enviado',
          em: evento.criado_em,
          detalhe: assunto,
        })
      } else if (evento.tipo === 'erro') {
        const motivo = typeof evento.detalhe?.erro === 'string' ? evento.detalhe.erro : null
        eventos.push({ tipo: 'erro', em: evento.criado_em, detalhe: motivo })
      }
    }

    let respondeuEm: string | null = null
    let closerAvisadoEm: string | null = null
    for (const interacao of execucao.lead_id ? interacoesPorLead.get(execucao.lead_id) ?? [] : []) {
      if (interacao.created_at < execucao.iniciado_em) continue
      if (interacao.tipo === 'resposta') {
        if (!respondeuEm) respondeuEm = interacao.created_at
        eventos.push({ tipo: 'resposta', em: interacao.created_at, detalhe: trecho(interacao.descricao) })
      } else if (interacao.descricao?.startsWith(PREFIXO_CLOSER)) {
        if (!closerAvisadoEm) closerAvisadoEm = interacao.created_at
        eventos.push({ tipo: 'closer', em: interacao.created_at, detalhe: null })
      }
    }

    if (execucao.status === 'cancelado') {
      eventos.push({ tipo: 'cancelado', em: execucao.iniciado_em, detalhe: null })
    }

    eventos.sort((a, b) => a.em.localeCompare(b.em))

    return {
      execucaoId: execucao.id,
      leadId: execucao.lead_id,
      empresa: lead?.empresa?.trim() || 'Lead sem empresa',
      contato: lead?.contato_nome?.trim() || null,
      email: lead?.contato_email?.trim() || null,
      statusExecucao: execucao.status,
      iniciadoEm: execucao.iniciado_em,
      enviadoEm,
      respondeuEm,
      closerAvisadoEm,
      eventos,
    }
  })

  const totais: TotaisLinhaDoTempo = {
    publico: destinatarios.length,
    enviados: destinatarios.filter((d) => d.enviadoEm).length,
    respostas: destinatarios.filter((d) => d.respondeuEm).length,
    falhas: destinatarios.filter((d) => d.statusExecucao === 'cancelado' || d.statusExecucao === 'erro').length,
    pendentes: destinatarios.filter(
      (d) => d.statusExecucao === 'aguardando' || d.statusExecucao === 'em_andamento',
    ).length,
  }

  return { destinatarios, totais }
}

// A descrição da resposta guarda o e-mail inteiro, incluindo o histórico citado.
// Na tela só interessa o começo — o resto é ruído de citação.
function trecho(descricao: string | null): string | null {
  if (!descricao) return null
  const primeiraLinhaUtil = descricao
    .split('\n')
    .map((linha) => linha.trim())
    .find((linha) => linha && !linha.startsWith('>') && !linha.startsWith('Em '))
  if (!primeiraLinhaUtil) return null
  return primeiraLinhaUtil.length > 120 ? `${primeiraLinhaUtil.slice(0, 120)}…` : primeiraLinhaUtil
}
