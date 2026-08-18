import type { BlocoConfig, DefinicaoWorkflow } from '@/lib/workflows/types'

export const NAO_CONFIGURADO = 'Não configurado'

export interface PublicoResumoOperacional {
  empresas?: {
    fonte?: string
    pais?: string
    segmento?: string
    cidades?: string
  }
  decisores?: {
    departamento?: string
    cargos?: string
    senioridade?: string
  }
  agenda?: {
    diasSemana?: string[]
    horarioInicio?: string
    horarioFim?: string
    limiteDiario?: number
    pararAoResponder?: boolean
  }
  selecao?: {
    modo?: 'filtros' | 'manual'
    leadIds?: string[]
    estagios?: string[]
  }
  operacao?: {
    mensagemInicial?: { assunto?: string }
    followups?: { assunto?: string; diasApos?: number }[]
    resposta?: { pararCadencia?: boolean }
  }
}

export interface WorkflowResumoOperacional {
  id: string
  nome: string
  status: string
  definicao: DefinicaoWorkflow | null
}

export interface ContextoResumoOperacional {
  remetente: string | null
  responsavel: string | null
  workflow: WorkflowResumoOperacional | null
}

const DIAS: Record<string, string> = {
  seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom',
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function formatarPublicoOperacional(publico: PublicoResumoOperacional | null): string {
  if (!publico) return NAO_CONFIGURADO
  const empresas = publico.empresas
  const decisores = publico.decisores
  const partes: string[] = []

  if (publico.selecao?.modo === 'manual') {
    const quantidade = publico.selecao.leadIds?.length ?? 0
    partes.push(quantidade ? `Seleção manual · ${quantidade} contato${quantidade === 1 ? '' : 's'}` : 'Seleção manual')
  }

  if (empresas?.fonte === 'base') partes.push('Base de leads existente')
  else if (texto(empresas?.fonte)) partes.push(texto(empresas?.fonte)!)

  const recorteEmpresas = [texto(empresas?.segmento), texto(empresas?.cidades), texto(empresas?.pais)].filter(Boolean)
  if (recorteEmpresas.length) partes.push(recorteEmpresas.join(' · '))

  const recorteDecisores = [texto(decisores?.departamento), texto(decisores?.cargos), texto(decisores?.senioridade)].filter(Boolean)
  if (recorteDecisores.length) partes.push(`Decisores: ${recorteDecisores.join(' · ')}`)
  if (publico.selecao?.estagios?.length) partes.push(`Status: ${publico.selecao.estagios.join(', ')}`)

  return partes.length ? partes.join(' — ') : NAO_CONFIGURADO
}

function blocosAninhados(bloco: BlocoConfig): BlocoConfig[] {
  if (bloco.tipo !== 'ramificar') return []
  const entao = Array.isArray(bloco.config?.entao) ? bloco.config.entao as BlocoConfig[] : []
  const senao = Array.isArray(bloco.config?.senao) ? bloco.config.senao as BlocoConfig[] : []
  return [...entao, ...senao]
}

export function extrairMensagensConfiguradas(definicao: DefinicaoWorkflow | null): string[] {
  if (!definicao) return []
  const mensagens: string[] = []

  const visitar = (bloco: BlocoConfig) => {
    if (bloco.tipo === 'enviar_email') {
      mensagens.push(`E-mail — ${texto(bloco.config?.template) ?? NAO_CONFIGURADO}`)
    } else if (bloco.tipo === 'enviar_whatsapp') {
      mensagens.push(`WhatsApp — ${texto(bloco.config?.texto) ?? NAO_CONFIGURADO}`)
    }
    for (const filho of blocosAninhados(bloco)) visitar(filho)
  }

  for (const bloco of definicao.acoes ?? []) visitar(bloco)
  return mensagens
}

export function formatarMensagensOperacionais(
  definicao: DefinicaoWorkflow | null,
  operacao?: PublicoResumoOperacional['operacao'],
): string {
  const configuradas = [operacao?.mensagemInicial, ...(operacao?.followups ?? [])]
    .map((mensagem) => texto(mensagem?.assunto))
    .filter((assunto): assunto is string => !!assunto)
  if (configuradas.length) {
    return `${configuradas.length} ${configuradas.length === 1 ? 'mensagem' : 'mensagens'} · ${configuradas.join(' · ')}`
  }
  const mensagens = extrairMensagensConfiguradas(definicao)
  if (!mensagens.length) return NAO_CONFIGURADO
  return `${mensagens.length} ${mensagens.length === 1 ? 'mensagem' : 'mensagens'} · ${mensagens.join(' · ')}`
}

export function formatarCadenciaOperacional(
  workflow: WorkflowResumoOperacional | null,
  agenda: PublicoResumoOperacional['agenda'],
  operacao?: PublicoResumoOperacional['operacao'],
): string {
  const partes: string[] = []
  if (texto(workflow?.nome)) partes.push(workflow!.nome)
  const etapas = workflow?.definicao?.acoes?.length
  if (typeof etapas === 'number' && etapas > 0) partes.push(`${etapas} ${etapas === 1 ? 'etapa' : 'etapas'}`)

  const dias = (agenda?.diasSemana ?? []).map((dia) => DIAS[dia] ?? dia).filter(Boolean)
  if (dias.length) partes.push(dias.join(', '))
  if (texto(agenda?.horarioInicio) && texto(agenda?.horarioFim)) {
    partes.push(`${agenda!.horarioInicio}–${agenda!.horarioFim}`)
  }
  if (typeof agenda?.limiteDiario === 'number') partes.push(`${agenda.limiteDiario}/dia`)
  const intervalos = (operacao?.followups ?? [])
    .map((followup) => followup.diasApos)
    .filter((dia): dia is number => typeof dia === 'number')
  if (intervalos.length) partes.push(`follow-up nos dias ${intervalos.join(', ')}`)

  return partes.length ? partes.join(' · ') : NAO_CONFIGURADO
}

export function formatarRegraResposta(pararAoResponder: boolean | undefined): string {
  if (pararAoResponder === true) return 'Parar ao receber resposta'
  if (pararAoResponder === false) return 'Continuar após resposta'
  return NAO_CONFIGURADO
}

export function formatarStatusOperacional(status: string | null, dryRun: boolean | null): string {
  const labels: Record<string, string> = {
    rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada', concluida: 'Concluída',
  }
  const campanha = status ? (labels[status] ?? status) : null
  const envio = dryRun === true ? 'Modo ensaio' : dryRun === false ? 'Envio real' : null
  return [campanha, envio].filter(Boolean).join(' · ') || NAO_CONFIGURADO
}

export function proximaAcaoOperacional(
  status: string | null,
  dryRun: boolean | null,
  workflowId: string | null,
): string {
  if (!status) return NAO_CONFIGURADO
  if (status !== 'concluida' && !workflowId) return 'Configurar cadência'
  if (status === 'rascunho') return 'Revisar e publicar em modo ensaio'
  if (status === 'ativa' && dryRun !== false) return 'Revisar ensaio e ativar envio real'
  if (status === 'ativa') return 'Pausar ou concluir campanha'
  if (status === 'pausada') return 'Retomar ou concluir campanha'
  if (status === 'concluida') return 'Nenhuma ação pendente'
  return NAO_CONFIGURADO
}
