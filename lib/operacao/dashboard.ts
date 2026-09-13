import { diasAteVencimento, formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import {
  TIPOS_INTERACAO_ENVIO,
  etapaAtivaDaCadencia,
  etapaAtualDaCadencia,
  etapaPorEnvios,
} from '@/lib/cadencia/classificacao'

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

export interface CicloLaudoParaHistorico {
  id: string
  leadId: string
  validadeEm: string
  renovadoEm: string | null
  criadoEm: string
}

export interface CicloRenovadoPareado {
  id: string
  leadId: string
  validadeAnterior: string
  novaValidade: string | null
  renovadoEm: string
}

export interface InteracaoProspeccaoMetrica {
  id: string
  leadId: string
  tipo: string
  canal: string | null
  origemAcao: string | null
  criadaEm: string
  segmento: string | null
  estado: string | null
}

export interface LeadCadenciaProspeccaoMetrica {
  leadId: string
  estagio: string | null
  inscritoEm: string
}

export interface DistribuicaoProspeccao {
  nome: string
  quantidade: number
  percentual: number
}

export interface ResumoInteracoesProspeccao {
  followUps: {
    clientes: number
    clientesAnteriores: number
    retornos: number
    retornosAnteriores: number
    serie: number[]
  }
  series: {
    mensagens: number[]
    respostas: number[]
  }
  nichos: DistribuicaoProspeccao[]
  respostasPorNichoRegiao: DistribuicaoProspeccao[]
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

// Cada renovação encerra um ciclo e abre o seguinte. O histórico guarda essas
// linhas separadamente; para exibir "validade anterior → nova validade", o
// próximo ciclo cronológico do mesmo lead é a fonte da nova data.
export function parearCiclosRenovados(ciclos: CicloLaudoParaHistorico[]): CicloRenovadoPareado[] {
  const porLead = new Map<string, CicloLaudoParaHistorico[]>()
  for (const ciclo of ciclos) {
    const atuais = porLead.get(ciclo.leadId) ?? []
    atuais.push(ciclo)
    porLead.set(ciclo.leadId, atuais)
  }

  const renovacoes: CicloRenovadoPareado[] = []
  for (const ciclosDoLead of porLead.values()) {
    const ordenados = [...ciclosDoLead].sort((a, b) => {
      const diferenca = (timestampValido(a.criadoEm) ?? 0) - (timestampValido(b.criadoEm) ?? 0)
      return diferenca || a.id.localeCompare(b.id)
    })
    ordenados.forEach((ciclo, indice) => {
      if (!ciclo.renovadoEm) return
      renovacoes.push({
        id: ciclo.id,
        leadId: ciclo.leadId,
        validadeAnterior: ciclo.validadeEm,
        novaValidade: ordenados[indice + 1]?.validadeEm ?? null,
        renovadoEm: ciclo.renovadoEm,
      })
    })
  }

  return renovacoes.sort((a, b) => {
    const diferenca = (timestampValido(b.renovadoEm) ?? 0) - (timestampValido(a.renovadoEm) ?? 0)
    return diferenca || a.id.localeCompare(b.id)
  })
}

export function variacaoPercentual(atual: number, anterior: number): number {
  if (anterior <= 0) return atual > 0 ? 100 : 0
  return Math.round(((atual - anterior) / anterior) * 100)
}

export function serieTemporal(
  datas: string[],
  inicio: Date,
  fim: Date,
  quantidadePontos = 12,
): number[] {
  const pontos = Math.max(1, Math.floor(quantidadePontos))
  const serie = Array.from({ length: pontos }, () => 0)
  const inicioMs = inicio.getTime()
  const fimMs = fim.getTime()
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || fimMs <= inicioMs) return serie

  const tamanhoFaixa = (fimMs - inicioMs) / pontos
  for (const data of datas) {
    const timestamp = timestampValido(data)
    if (timestamp === null || timestamp < inicioMs || timestamp >= fimMs) continue
    const indice = Math.min(pontos - 1, Math.floor((timestamp - inicioMs) / tamanhoFaixa))
    serie[indice] += 1
  }
  return serie
}

function noPeriodo(registro: InteracaoProspeccaoMetrica, inicio: Date, fim: Date): boolean {
  const timestamp = timestampValido(registro.criadaEm)
  return timestamp !== null && timestamp >= inicio.getTime() && timestamp < fim.getTime()
}

interface EnvioCadenciaClassificado {
  registro: InteracaoProspeccaoMetrica
  numero: number
}

function ehEnvioDaCadencia(registro: InteracaoProspeccaoMetrica): boolean {
  return TIPOS_INTERACAO_ENVIO.includes(registro.tipo)
    && registro.canal === 'email'
    && registro.origemAcao === 'ia'
}

function classificarEnviosDaCadencia(
  registros: InteracaoProspeccaoMetrica[],
): EnvioCadenciaClassificado[] {
  const envios = registros
    .filter(ehEnvioDaCadencia)
    .flatMap((registro) => {
      const timestamp = timestampValido(registro.criadaEm)
      return timestamp === null ? [] : [{ registro, timestamp }]
    })
    .sort((a, b) => a.timestamp - b.timestamp || a.registro.id.localeCompare(b.registro.id))
  const quantidadePorLead = new Map<string, number>()

  return envios.map(({ registro }) => {
    const numero = (quantidadePorLead.get(registro.leadId) ?? 0) + 1
    quantidadePorLead.set(registro.leadId, numero)
    return { registro, numero }
  })
}

function idsComRetornoDeFollowUp(
  respostas: InteracaoProspeccaoMetrica[],
  followUps: EnvioCadenciaClassificado[],
): Set<string> {
  const primeiroFollowUp = new Map<string, number>()
  for (const { registro } of followUps) {
    const timestamp = timestampValido(registro.criadaEm)
    if (timestamp === null) continue
    const atual = primeiroFollowUp.get(registro.leadId)
    if (atual === undefined || timestamp < atual) primeiroFollowUp.set(registro.leadId, timestamp)
  }

  const retornos = new Set<string>()
  for (const registro of respostas) {
    const timestamp = timestampValido(registro.criadaEm)
    const followUp = primeiroFollowUp.get(registro.leadId)
    if (timestamp !== null && followUp !== undefined && timestamp >= followUp) retornos.add(registro.leadId)
  }
  return retornos
}

function snapshotDaCadencia(
  leads: LeadCadenciaProspeccaoMetrica[],
  envios: EnvioCadenciaClassificado[],
  respostas: InteracaoProspeccaoMetrica[],
  limite: Date,
  usarEstagioAtual: boolean,
): { ativos: number; responderam: number } {
  const limiteMs = limite.getTime()
  const enviosPorLead = new Map<string, number>()
  for (const { registro } of envios) {
    const timestamp = timestampValido(registro.criadaEm)
    if (timestamp !== null && timestamp < limiteMs) {
      enviosPorLead.set(registro.leadId, (enviosPorLead.get(registro.leadId) ?? 0) + 1)
    }
  }

  const respostasAteLimite = new Set(respostas.flatMap((registro) => {
    const timestamp = timestampValido(registro.criadaEm)
    return timestamp !== null && timestamp < limiteMs ? [registro.leadId] : []
  }))
  const primeiroVinculo = new Map<string, LeadCadenciaProspeccaoMetrica>()
  for (const lead of leads) {
    const atual = primeiroVinculo.get(lead.leadId)
    const inscritoEm = timestampValido(lead.inscritoEm)
    const atualEm = timestampValido(atual?.inscritoEm)
    if (!atual || (inscritoEm !== null && (atualEm === null || inscritoEm < atualEm))) {
      primeiroVinculo.set(lead.leadId, lead)
    }
  }

  let ativos = 0
  let responderam = 0
  for (const lead of primeiroVinculo.values()) {
    const inscritoEm = timestampValido(lead.inscritoEm)
    if (inscritoEm === null || inscritoEm >= limiteMs) continue
    const quantidadeEnvios = enviosPorLead.get(lead.leadId) ?? 0
    const etapa = usarEstagioAtual
      ? etapaAtualDaCadencia(quantidadeEnvios, lead.estagio)
      : respostasAteLimite.has(lead.leadId)
        ? 'respondeu'
        : etapaPorEnvios(quantidadeEnvios)
    if (etapa === 'respondeu') responderam += 1
    else if (etapaAtivaDaCadencia(etapa)) ativos += 1
  }
  return { ativos, responderam }
}

function distribuicao(contagem: Map<string, number>, total: number): DistribuicaoProspeccao[] {
  return [...contagem.entries()]
    .map(([nome, quantidade]) => ({
      nome,
      quantidade,
      percentual: total > 0 ? Math.round((quantidade / total) * 100) : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'))
}

// As mensagens e os estágios usam a mesma regra da visão Cadência: inscrição
// persistida, e-mails dos dois motores e precedência do estágio de resposta.
// Sem a lista de inscritos (fallback de testes/compatibilidade), o resumo ainda
// consegue medir atividade por período sem inventar participantes da cadência.
export function resumirInteracoesProspeccao(
  interacoes: InteracaoProspeccaoMetrica[],
  inicioAnterior: Date,
  inicioAtual: Date,
  fimAtual: Date,
  leadsCadencia: LeadCadenciaProspeccaoMetrica[] = [],
): ResumoInteracoesProspeccao {
  const atuais = interacoes.filter((item) => noPeriodo(item, inicioAtual, fimAtual))
  const anteriores = interacoes.filter((item) => noPeriodo(item, inicioAnterior, inicioAtual))
  const enviosClassificados = classificarEnviosDaCadencia(interacoes)
  const followUps = enviosClassificados.filter((item) => item.numero >= 2)
  const followUpsAtuais = followUps.filter((item) => noPeriodo(item.registro, inicioAtual, fimAtual))
  const followUpsAnteriores = followUps.filter((item) => noPeriodo(item.registro, inicioAnterior, inicioAtual))
  const mensagensAtuais = atuais.filter(ehEnvioDaCadencia)
  const respostasAtuais = atuais.filter((item) => item.tipo === 'resposta')
  const respostasAnteriores = anteriores.filter((item) => item.tipo === 'resposta')
  const todasRespostas = interacoes.filter((item) => item.tipo === 'resposta')
  const snapshotAtual = leadsCadencia.length
    ? snapshotDaCadencia(leadsCadencia, enviosClassificados, todasRespostas, fimAtual, true)
    : null
  const snapshotAnterior = leadsCadencia.length
    ? snapshotDaCadencia(leadsCadencia, enviosClassificados, todasRespostas, inicioAtual, false)
    : null

  const nichoPorLead = new Map<string, string>()
  for (const item of mensagensAtuais) {
    if (!nichoPorLead.has(item.leadId)) nichoPorLead.set(item.leadId, item.segmento?.trim() || 'Sem nicho')
  }
  const contagemNichos = new Map<string, number>()
  for (const nicho of nichoPorLead.values()) contagemNichos.set(nicho, (contagemNichos.get(nicho) ?? 0) + 1)

  const contagemRespostas = new Map<string, number>()
  for (const item of respostasAtuais) {
    const nicho = item.segmento?.trim() || 'Sem nicho'
    const estado = item.estado?.trim().toUpperCase() || 'Sem UF'
    const chave = `${nicho} · ${estado}`
    contagemRespostas.set(chave, (contagemRespostas.get(chave) ?? 0) + 1)
  }

  return {
    followUps: {
      clientes: snapshotAtual?.ativos ?? new Set(followUpsAtuais.map((item) => item.registro.leadId)).size,
      clientesAnteriores: snapshotAnterior?.ativos ?? new Set(followUpsAnteriores.map((item) => item.registro.leadId)).size,
      retornos: snapshotAtual?.responderam ?? idsComRetornoDeFollowUp(respostasAtuais, followUps).size,
      retornosAnteriores: snapshotAnterior?.responderam ?? idsComRetornoDeFollowUp(respostasAnteriores, followUps).size,
      serie: serieTemporal(followUpsAtuais.map((item) => item.registro.criadaEm), inicioAtual, fimAtual),
    },
    series: {
      mensagens: serieTemporal(mensagensAtuais.map((item) => item.criadaEm), inicioAtual, fimAtual),
      respostas: serieTemporal(respostasAtuais.map((item) => item.criadaEm), inicioAtual, fimAtual),
    },
    nichos: distribuicao(contagemNichos, nichoPorLead.size),
    respostasPorNichoRegiao: distribuicao(contagemRespostas, respostasAtuais.length),
  }
}
