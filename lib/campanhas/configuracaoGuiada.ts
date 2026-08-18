import type { Publico, MensagemCampanha, FollowupCampanha } from '@/components/automacao/tiposCampanha'
import type { DefinicaoWorkflow } from '@/lib/workflows/types'

export const LIMITE_CONFIRMACAO_CAMPANHA = 100
export const LIMITE_PUBLICO_CAMPANHA = 2000
export const LIMITE_HTML_CAMPANHA = 200_000

export const TIPOS_CAMPANHA = [
  { id: 'prospeccao', label: 'Prospectar novos leads', descricao: 'Iniciar uma nova abordagem comercial.' },
  { id: 'followup', label: 'Fazer follow-up', descricao: 'Retomar contatos existentes sem resposta.' },
  { id: 'reativacao', label: 'Reativar contatos antigos', descricao: 'Voltar a falar com contatos sem avanço recente.' },
  { id: 'novidade_clientes', label: 'Enviar uma novidade', descricao: 'Comunicar clientes sobre uma novidade ou conteúdo.' },
  { id: 'renovacao', label: 'Comunicar renovação', descricao: 'Avisar sobre renovação ou vencimento.' },
] as const

export type TipoCampanhaGuiada = (typeof TIPOS_CAMPANHA)[number]['id']

export const GRUPOS_STATUS_PUBLICO = [
  { id: 'primeiro_contato', label: 'Primeiro contato', estagios: ['primeiro_contato'] },
  { id: 'aguardando_resposta', label: 'Aguardando resposta', estagios: ['aguardando_resposta'] },
  { id: 'follow_up', label: 'Em follow-up', estagios: ['follow_up', 'follow_up_1', 'follow_up_2'] },
  { id: 'sem_resposta', label: 'Não respondeu no prazo', estagios: ['sem_resposta'] },
] as const

export const VARIAVEIS_EMAIL_RESPOSTA = [
  '{empresa}', '{contato}', '{email_contato}', '{nicho}', '{score}', '{resposta}',
  '{campanha}', '{tipo_campanha}', '{responsavel}',
] as const

export function modeloEmailRespostaCampanha(tipo: string | null | undefined) {
  const objetivo = labelTipoCampanha(tipo)
  return {
    assunto: `[ProspectOS] Resposta em ${objetivo.toLowerCase()}: {empresa}`,
    corpo: [
      'O lead respondeu à campanha "{campanha}".',
      '',
      'Objetivo: {tipo_campanha}',
      'Empresa: {empresa}',
      'Contato: {contato} <{email_contato}>',
      'Nicho: {nicho}',
      'Score: {score}',
      '',
      'Resposta recebida:',
      '{resposta}',
      '',
      'Responsável pelo retorno: {responsavel}',
    ].join('\n'),
  }
}

const REGRAS_PUBLICO: Record<string, {
  estagios: string[]
  permitirEscolhaStatus: boolean
  criterio: 'estagios' | 'base' | 'clientes' | 'renovacao'
  titulo: string
  descricao: string
}> = {
  prospeccao: {
    estagios: ['novo', 'novos_leads'],
    permitirEscolhaStatus: false,
    criterio: 'estagios',
    titulo: 'Novos leads',
    descricao: 'Somente leads novos, ainda fora da prospecção e do follow-up.',
  },
  followup: {
    estagios: GRUPOS_STATUS_PUBLICO.flatMap((grupo) => [...grupo.estagios]),
    permitirEscolhaStatus: true,
    criterio: 'estagios',
    titulo: 'Contatos em acompanhamento',
    descricao: 'Escolha quais etapas atuais da prospecção devem receber o acompanhamento.',
  },
  reativacao: {
    estagios: ['sem_resposta'],
    permitirEscolhaStatus: false,
    criterio: 'estagios',
    titulo: 'Contatos sem resposta',
    descricao: 'Somente contatos que encerraram a cadência anterior sem responder.',
  },
  novidade_clientes: {
    estagios: [],
    permitirEscolhaStatus: false,
    criterio: 'base',
    titulo: 'Toda a Base de Leads',
    descricao: 'Todos os contatos reais da base entram na prévia; bloqueios, duplicidades e automações ativas continuam sendo excluídos.',
  },
  renovacao: {
    estagios: [],
    permitirEscolhaStatus: false,
    criterio: 'renovacao',
    titulo: 'Clientes elegíveis para renovação',
    descricao: 'Somente empresas com serviço recorrente vigente; prospecção e follow-up são excluídos.',
  },
}

export function regraPublicoCampanha(tipo: string | null | undefined) {
  return REGRAS_PUBLICO[tipo ?? ''] ?? REGRAS_PUBLICO.prospeccao
}

// O objetivo é uma regra de servidor, não apenas uma preferência visual. Isso
// impede que um payload manipulado inclua prospecção/FUP numa renovação.
export function aplicarRegraPublicoPorTipo(publico: Publico, tipo: string | null | undefined): Publico {
  const regra = regraPublicoCampanha(tipo)
  const atuais = publico.selecao?.estagios ?? []
  const permitidos = atuais.filter((estagio) => regra.estagios.includes(estagio))
  const estagios = regra.criterio === 'estagios'
    ? (regra.permitirEscolhaStatus && permitidos.length ? permitidos : regra.estagios)
    : undefined
  const modeloResposta = modeloEmailRespostaCampanha(tipo)
  return {
    ...publico,
    empresas: {
      ...publico.empresas,
      // O fluxo guiado segmenta por nicho/status. Campos geográficos legados
      // não podem continuar filtrando silenciosamente um objetivo novo.
      pais: undefined,
      cidades: undefined,
    },
    selecao: { ...publico.selecao, estagios: estagios ? [...estagios] : undefined, criterio: regra.criterio },
    operacao: {
      ...publico.operacao,
      resposta: {
        ...publico.operacao?.resposta,
        emailAssunto: publico.operacao?.resposta?.emailAssunto?.trim() || modeloResposta.assunto,
        emailCorpo: publico.operacao?.resposta?.emailCorpo?.trim() || modeloResposta.corpo,
      },
    },
  }
}

const texto = (valor: unknown): string | undefined =>
  typeof valor === 'string' && valor.trim() ? valor.trim() : undefined

const numeroPositivo = (valor: unknown): number | undefined => {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

const strings = (valor: unknown): string[] | undefined => {
  if (!Array.isArray(valor)) return undefined
  const itens = [...new Set(valor.map(texto).filter((v): v is string => !!v))]
  return itens.length ? itens : undefined
}

function normalizarMensagem(raw: unknown): MensagemCampanha | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const mensagem: MensagemCampanha = {
    assunto: texto(obj.assunto),
    corpo: texto(obj.corpo),
    html: texto(obj.html),
    link: texto(obj.link),
    templateOrigemId: texto(obj.templateOrigemId),
    templateId: texto(obj.templateId),
    templateTipo: texto(obj.templateTipo),
  }
  return Object.values(mensagem).some(Boolean) ? mensagem : undefined
}

function normalizarFollowups(raw: unknown): FollowupCampanha[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const itens: FollowupCampanha[] = []
  for (const item of raw.slice(0, 4)) {
    const mensagem = normalizarMensagem(item)
    const diasApos = item && typeof item === 'object' && !Array.isArray(item)
      ? numeroPositivo((item as Record<string, unknown>).diasApos)
      : undefined
    if (mensagem || diasApos) itens.push({ ...(mensagem ?? {}), diasApos })
  }
  return itens.length ? itens : undefined
}

export function normalizarPublicoCampanha(raw: unknown): Publico {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const empresasRaw = obj.empresas && typeof obj.empresas === 'object' && !Array.isArray(obj.empresas)
    ? obj.empresas as Record<string, unknown>
    : {}
  const decisoresRaw = obj.decisores && typeof obj.decisores === 'object' && !Array.isArray(obj.decisores)
    ? obj.decisores as Record<string, unknown>
    : {}
  const agendaRaw = obj.agenda && typeof obj.agenda === 'object' && !Array.isArray(obj.agenda)
    ? obj.agenda as Record<string, unknown>
    : {}
  const selecaoRaw = obj.selecao && typeof obj.selecao === 'object' && !Array.isArray(obj.selecao)
    ? obj.selecao as Record<string, unknown>
    : {}
  const operacaoRaw = obj.operacao && typeof obj.operacao === 'object' && !Array.isArray(obj.operacao)
    ? obj.operacao as Record<string, unknown>
    : {}
  const respostaRaw = operacaoRaw.resposta && typeof operacaoRaw.resposta === 'object' && !Array.isArray(operacaoRaw.resposta)
    ? operacaoRaw.resposta as Record<string, unknown>
    : {}

  const pararCadencia = typeof respostaRaw.pararCadencia === 'boolean'
    ? respostaRaw.pararCadencia
    : typeof agendaRaw.pararAoResponder === 'boolean' ? agendaRaw.pararAoResponder : true

  return {
    objetivo: texto(obj.objetivo),
    responsavel: texto(obj.responsavel),
    responsavel_id: texto(obj.responsavel_id),
    idioma: texto(obj.idioma),
    prazo: texto(obj.prazo),
    empresas: {
      fonte: texto(empresasRaw.fonte) ?? 'base',
      pais: texto(empresasRaw.pais),
      segmento: texto(empresasRaw.segmento),
      cidades: texto(empresasRaw.cidades),
      limite: numeroPositivo(empresasRaw.limite),
      removerDuplicados: empresasRaw.removerDuplicados !== false,
      exigirSite: empresasRaw.exigirSite === true,
    },
    decisores: {
      departamento: texto(decisoresRaw.departamento),
      cargos: texto(decisoresRaw.cargos),
      senioridade: texto(decisoresRaw.senioridade),
      maxPorEmpresa: numeroPositivo(decisoresRaw.maxPorEmpresa),
      exigirEmail: decisoresRaw.exigirEmail !== false,
      exigirTelefone: decisoresRaw.exigirTelefone === true,
    },
    agenda: {
      diasSemana: strings(agendaRaw.diasSemana) ?? ['seg', 'ter', 'qua', 'qui', 'sex'],
      horarioInicio: texto(agendaRaw.horarioInicio) ?? '09:00',
      horarioFim: texto(agendaRaw.horarioFim) ?? '18:00',
      limiteDiario: numeroPositivo(agendaRaw.limiteDiario),
      pararAoResponder: pararCadencia,
    },
    selecao: {
      modo: selecaoRaw.modo === 'manual' ? 'manual' : 'filtros',
      leadIds: strings(selecaoRaw.leadIds),
      excluirLeadIds: strings(selecaoRaw.excluirLeadIds),
      excluirEmpresas: strings(selecaoRaw.excluirEmpresas),
      estagios: strings(selecaoRaw.estagios),
      criterio: selecaoRaw.criterio === 'base' || selecaoRaw.criterio === 'clientes' || selecaoRaw.criterio === 'renovacao'
        ? selecaoRaw.criterio
        : 'estagios',
    },
    operacao: {
      remetenteConta: texto(operacaoRaw.remetenteConta),
      remetenteEmail: texto(operacaoRaw.remetenteEmail),
      mensagemInicial: normalizarMensagem(operacaoRaw.mensagemInicial),
      followups: normalizarFollowups(operacaoRaw.followups),
      resposta: {
        pararCadencia,
        criarTarefa: respostaRaw.criarTarefa === true,
        prazoHoras: numeroPositivo(respostaRaw.prazoHoras) ?? 24,
        notificarResponsavel: respostaRaw.notificarResponsavel !== false,
        notificarAdministradores: respostaRaw.notificarAdministradores === true,
        prepararSugestao: respostaRaw.prepararSugestao === true,
        emailAssunto: texto(respostaRaw.emailAssunto),
        emailCorpo: texto(respostaRaw.emailCorpo),
        emailHtml: texto(respostaRaw.emailHtml),
      },
      workflowGerenciadoId: texto(operacaoRaw.workflowGerenciadoId),
    },
  }
}

export function urlPermitida(valor: string | undefined): boolean {
  if (!valor) return true
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function corpoComLink(mensagem: MensagemCampanha): string {
  const corpo = mensagem.corpo?.trim() ?? ''
  const link = mensagem.link?.trim()
  if (!link || corpo.includes(link)) return corpo
  return `${corpo}\n\n${link}`
}

export function validarCampanhaGuiada(publico: Publico): string[] {
  const erros: string[] = []
  const op = publico.operacao
  const inicial = op?.mensagemInicial
  if (!op?.remetenteEmail) erros.push('Configure uma conta remetente no workspace.')
  if (!publico.responsavel_id) erros.push('Defina o responsável pelos retornos.')
  if (op?.resposta?.notificarResponsavel !== false && !op?.resposta?.emailAssunto) {
    erros.push('Informe o assunto do e-mail de resposta ao responsável.')
  }
  if (op?.resposta?.notificarResponsavel !== false && !op?.resposta?.emailCorpo) {
    erros.push('Informe o conteúdo do e-mail de resposta ao responsável.')
  }
  if (!inicial?.assunto) erros.push('Informe o assunto da mensagem inicial.')
  if (!inicial?.corpo) erros.push('Escreva a mensagem inicial ou escolha um template.')
  if ((inicial?.html?.length ?? 0) > LIMITE_HTML_CAMPANHA) erros.push('O HTML da mensagem inicial excede 200 KB.')
  if (!urlPermitida(inicial?.link)) erros.push('O link da mensagem inicial precisa usar http ou https.')
  for (const [indice, followup] of (op?.followups ?? []).entries()) {
    if (!followup.assunto || !followup.corpo || !followup.diasApos) {
      erros.push(`Complete a mensagem e o intervalo do follow-up ${indice + 1}.`)
    }
    if (!urlPermitida(followup.link)) erros.push(`O link do follow-up ${indice + 1} precisa usar http ou https.`)
    if ((followup.html?.length ?? 0) > LIMITE_HTML_CAMPANHA) erros.push(`O HTML do follow-up ${indice + 1} excede 200 KB.`)
  }
  if ((op?.resposta?.emailHtml?.length ?? 0) > LIMITE_HTML_CAMPANHA) erros.push('O HTML do e-mail de resposta excede 200 KB.')
  const dias = (op?.followups ?? []).map((f) => f.diasApos ?? 0)
  if (dias.some((dia, i) => i > 0 && dia <= dias[i - 1])) {
    erros.push('Os follow-ups precisam ter intervalos crescentes.')
  }
  if (publico.selecao?.modo === 'manual' && !publico.selecao.leadIds?.length) {
    erros.push('Selecione ao menos um contato.')
  }
  if (!publico.agenda?.diasSemana?.length) erros.push('Escolha ao menos um dia de envio.')
  return erros
}

export function tipoTemplateCampanha(campanhaId: string, indice: number): string {
  return `campanha_${campanhaId.replace(/[^a-zA-Z0-9]/g, '')}_m${indice + 1}`.toLowerCase()
}

export function montarDefinicaoCampanha(publico: Publico): DefinicaoWorkflow {
  const op = publico.operacao
  if (!op?.mensagemInicial?.templateTipo) throw new Error('A mensagem inicial ainda não foi materializada.')
  // Follow-ups parciais permanecem no rascunho amigável, mas só entram no
  // workflow quando assunto, corpo e template já estiverem completos.
  const mensagens: MensagemCampanha[] = [
    op.mensagemInicial,
    ...(op.followups ?? []).filter((mensagem) => !!mensagem.templateTipo),
  ]

  const acoes: DefinicaoWorkflow['acoes'] = []
  let diaAnterior = 0
  mensagens.forEach((mensagem, indice) => {
    const diaAtual = indice === 0 ? 0 : (mensagem as FollowupCampanha).diasApos ?? diaAnterior
    const espera = diaAtual - diaAnterior
    if (espera > 0) {
      acoes.push({ id: `espera-${indice}`, tipo: 'esperar', config: { dias: espera, horas: 0 } })
    }
    acoes.push({ id: `email-${indice}`, tipo: 'enviar_email', config: { template: mensagem.templateTipo } })
    diaAnterior = diaAtual
  })

  return {
    gatilho: { id: 'gatilho-manual', tipo: 'manual', config: {} },
    condicoes: [],
    acoes,
  }
}

export function labelTipoCampanha(tipo: string | null | undefined): string {
  return TIPOS_CAMPANHA.find((item) => item.id === tipo)?.label ?? tipo ?? 'Não configurado'
}
