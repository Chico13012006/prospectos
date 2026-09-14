// Texto do aviso ao grupo comercial. PURO: só formata os dados congelados no
// outbox. Menção ao responsável é texto simples ("@Nome") — não há vínculo
// confiável usuário → telefone do WhatsApp no projeto (usuarios não tem
// telefone; perfis.telefone não é ponte) para uma menção real da Z-API.
import type { DadosAlertaHandoff, TipoNotificacaoHandoff } from './types'

const ou = (v: string | null | undefined, padrao: string) => (v && v.trim() ? v.trim() : padrao)

// "5 minutos" / "3 horas" / "7 dias" — tempo decorrido entre dois instantes.
// Arredonda para baixo; nunca negativo; abaixo de 1 minuto = "menos de 1 minuto".
export function descreverTempoDecorrido(inicioISO: string, agoraISO: string): string {
  const ms = new Date(agoraISO).getTime() - new Date(inicioISO).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'menos de 1 minuto'
  const minutos = Math.floor(ms / 60_000)
  if (minutos < 60) return `${minutos} minuto${minutos === 1 ? '' : 's'}`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `${horas} hora${horas === 1 ? '' : 's'}`
  const dias = Math.floor(horas / 24)
  return `${dias} dia${dias === 1 ? '' : 's'}`
}

// Check-in (Fase 3): pergunta o status ao responsável sem mudar nada no lead.
// Sem empresa, o lead é identificado pelo contato; sem nenhum dos dois, pelo
// que houver — nunca inventa dado.
export function montarMensagemCheckin(d: DadosAlertaHandoff, codigoRef: string | null = null): string {
  const responsavel = ou(d.responsavelNome, 'Responsável não informado')
  const empresa = ou(d.empresa, '')
  const contato = ou(d.contato, '')
  const nomeLead = empresa || contato || 'sem identificação'
  const linhas = [
    'ACOMPANHAMENTO COMERCIAL — ProspectOS',
    '',
    `@${responsavel}, como ficou o lead ${nomeLead}?`,
    '',
    `Contato: ${contato || 'não informado'}`,
    `Responsável: ${responsavel}`,
    `Em contato comercial há ${ou(d.tempoEmContato, 'algum tempo')}.`,
  ]
  // Fase 4: a referência é a ÚNICA correlação aceita na resposta do grupo.
  if (codigoRef) {
    linhas.push('', `Ref: #${codigoRef}`, '', 'Responda:', `#${codigoRef} 1 — Continuar comigo`, `#${codigoRef} 2 — Voltar para follow-up`)
  } else {
    linhas.push('', 'Informe o status deste lead para definirmos o próximo passo.')
  }
  return linhas.join('\n')
}

// Despacho por tipo — é o que o outbox usa ao enviar/reprocessar.
export function montarMensagemNotificacao(tipo: TipoNotificacaoHandoff, d: DadosAlertaHandoff, codigoRef: string | null = null): string {
  return tipo === 'handoff_checkin' ? montarMensagemCheckin(d, codigoRef) : montarMensagemGrupo(d)
}

export function montarMensagemGrupo(d: DadosAlertaHandoff): string {
  const empresa = ou(d.empresa, 'Empresa não informada')
  const contato = ou(d.contato, 'Contato não informado')
  const responsavel = ou(d.responsavelNome, 'Responsável não informado')

  if (d.motivo === 'reativacao') {
    return [
      'LEAD VOLTOU A RESPONDER — ProspectOS',
      '',
      `Empresa: ${empresa}`,
      `Contato: ${contato}`,
      `Responsável: @${responsavel}`,
      '',
      'Este lead voltou a responder durante o follow-up automático',
      'e retorna para o mesmo responsável comercial.',
      '',
      'Status: Em contato comercial',
    ].join('\n')
  }

  return [
    'NOVO LEAD INTERESSADO — ProspectOS',
    '',
    `Empresa: ${empresa}`,
    `Contato: ${contato}`,
    `Responsável: @${responsavel}`,
    `Origem: Respondeu ao ${ou(d.etapaCadencia, 'contato de prospecção')}`,
    '',
    'Status: Em contato comercial',
    '',
    `O lead foi direcionado para ${responsavel}.`,
  ].join('\n')
}
