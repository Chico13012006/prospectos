import { diasAteVencimento, formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'

export interface RegistroControleVencimento {
  id: string
  fonte: 'servico' | 'lead_legado'
  leadId: string | null
  empresaId: string | null
  empresa: string
  tipo: string
  vencimentoEm: string
}

export interface ClienteControleVencimento {
  chave: string
  leadId: string | null
  empresaId: string | null
  empresa: string
  vencimentoMaisProximo: string
  diasRestantes: number
  status: 'vencido' | 'critico' | 'atencao' | 'no_prazo'
  motivos: { id: string; tipo: string; vencimentoEm: string; diasRestantes: number }[]
}

export interface ResumoEmpresasVencimento {
  vencidas: number
  proximos30: number
  entre31e60: number
  proximos60: number
  totalMonitoradas: number
}

export type SituacaoRenovacao =
  | 'nao_comunicado'
  | 'agendado'
  | 'em_acompanhamento'
  | 'enviado'
  | 'respondido'
  | 'erro'
  | 'encerrado'

export interface ContextoSituacaoRenovacao {
  execucaoStatus?: string | null
  execucaoIniciadaEm?: string | null
  ultimaMensagemEm?: string | null
  ultimaRespostaEm?: string | null
}

function citarValorFiltroPostgrest(valor: string): string {
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// leads.responsavel_id é a chave atual; registros legados podem carregar só o
// nome completo. O filtro mantém o fallback por prefixo usado no restante do
// CRM sem aceitar sintaxe PostgREST vinda do nome do usuário.
export function filtroResponsavelDashboard(responsavelId: string, responsavelNome: string): string {
  const nome = responsavelNome.trim()
  if (!nome) return `responsavel_id.eq.${responsavelId}`
  return [
    `responsavel_id.eq.${responsavelId}`,
    `and(responsavel_id.is.null,responsavel_nome.ilike.${citarValorFiltroPostgrest(`${nome}%`)})`,
  ].join(',')
}

export function podeVerDashboardDaEquipe(role: string): boolean {
  return role === 'admin'
}

function timestampValido(valor?: string | null): number | null {
  if (!valor) return null
  const timestamp = new Date(valor).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

// Resume o estado operacional sem inferir sucesso quando não há evidência.
// Resposta só pertence ao ciclo quando ocorreu depois do início da execução;
// envio real depende do evento/interação persistido, nunca só do status do job.
export function situacaoRenovacao({
  execucaoStatus,
  execucaoIniciadaEm,
  ultimaMensagemEm,
  ultimaRespostaEm,
}: ContextoSituacaoRenovacao): SituacaoRenovacao {
  const inicio = timestampValido(execucaoIniciadaEm)
  const mensagem = timestampValido(ultimaMensagemEm)
  const resposta = timestampValido(ultimaRespostaEm)
  const referenciaCiclo = inicio ?? mensagem

  if (resposta !== null && referenciaCiclo !== null && resposta >= referenciaCiclo) return 'respondido'
  if (execucaoStatus === 'erro') return 'erro'

  const ativa = execucaoStatus === 'em_andamento' || execucaoStatus === 'aguardando'
  if (mensagem !== null && ativa) return 'em_acompanhamento'
  if (mensagem !== null) return 'enviado'
  if (ativa) return 'agendado'
  if (execucaoStatus === 'cancelado' || execucaoStatus === 'concluido') return 'encerrado'
  return 'nao_comunicado'
}

export function statusVencimento(dias: number): ClienteControleVencimento['status'] {
  if (dias < 0) return 'vencido'
  if (dias <= 7) return 'critico'
  if (dias <= 30) return 'atencao'
  return 'no_prazo'
}

// A unidade visual é o cliente, não o laudo. Todos os motivos conhecidos são
// agrupados e ordenados pelo prazo mais urgente, para uma campanha poder gerar
// uma única conversa mesmo quando há mais de um documento a renovar.
export function agruparVencimentosPorCliente(
  registros: RegistroControleVencimento[],
  hoje = new Date(),
  limite = 6,
): ClienteControleVencimento[] {
  const grupos = new Map<string, ClienteControleVencimento>()

  const validos = registros.flatMap((registro) => {
    const dias = diasAteVencimento(registro.vencimentoEm, hoje)
    if (dias === null || !formatarDataIsoSemFuso(registro.vencimentoEm)) return []
    return [{ registro, dias }]
  }).sort((a, b) => a.dias - b.dias || a.registro.id.localeCompare(b.registro.id))

  for (const { registro, dias } of validos) {
    const chave = registro.empresaId
      ? `empresa:${registro.empresaId}`
      : registro.leadId
        ? `lead:${registro.leadId}`
        : `registro:${registro.fonte}:${registro.id}`
    const atual = grupos.get(chave)
    const motivo = { id: registro.id, tipo: registro.tipo, vencimentoEm: registro.vencimentoEm, diasRestantes: dias }
    if (atual) {
      atual.motivos.push(motivo)
      continue
    }
    grupos.set(chave, {
      chave,
      leadId: registro.leadId,
      empresaId: registro.empresaId,
      empresa: registro.empresa || 'Cliente sem nome',
      vencimentoMaisProximo: registro.vencimentoEm,
      diasRestantes: dias,
      status: statusVencimento(dias),
      motivos: [motivo],
    })
  }

  return [...grupos.values()].slice(0, Math.max(0, limite))
}

// As faixas são exclusivas e usam a validade mais urgente de cada empresa.
// Assim, uma empresa com vários laudos aparece uma única vez no resumo e nunca
// infla simultaneamente os cartões de 30 e 60 dias.
export function resumirEmpresasVencimento(
  registros: RegistroControleVencimento[],
  hoje = new Date(),
): ResumoEmpresasVencimento {
  const clientes = agruparVencimentosPorCliente(registros, hoje, Number.MAX_SAFE_INTEGER)
  const resumo: ResumoEmpresasVencimento = {
    vencidas: 0,
    proximos30: 0,
    entre31e60: 0,
    proximos60: 0,
    totalMonitoradas: clientes.length,
  }

  for (const cliente of clientes) {
    const dias = cliente.diasRestantes
    if (dias < 0) resumo.vencidas += 1
    else if (dias <= 30) resumo.proximos30 += 1
    else if (dias <= 60) resumo.entre31e60 += 1
  }
  resumo.proximos60 = resumo.proximos30 + resumo.entre31e60
  return resumo
}
