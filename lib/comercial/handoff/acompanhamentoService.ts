// Acompanhamento do handoff (Fase 3): depois da janela de revisão (padrão 7
// dias) com o handoff ainda ABERTO, a ProspectOS pergunta o status ao
// responsável no grupo comercial — UMA vez por handoff. Só isso: não
// interpreta resposta, não altera lead, responsável, cursor, estágio ou cadência.
//
// O relógio é comercial_handoffs.atribuido_em (Fase 1); a janela é config da
// organização (comercial.handoffRevisaoMinutos, resolvida pelo chamador via
// `deps.lerJanelaMinutos`). O envio reutiliza o outbox da Fase 2
// (comercial_handoff_notificacoes) com tipo 'handoff_checkin':
//   - identidade única (handoff_id, tipo) → nunca dois check-ins do mesmo handoff;
//   - claim por compare-and-swap → dois executores, uma chamada à Z-API;
//   - falha (Z-API fora, grupo sem config) fica recuperável no outbox e volta
//     pelo reprocesso já existente; 'enviando' preso é 'incerta' e não reenvia.
//
// Quem chama é o scheduler comercial (acompanhamentoScheduler + fila durável
// própria) e a rota interna /api/comercial/handoff/acompanhamento. Além de
// processar os vencidos, o resumo diz ao scheduler QUANDO acordar de novo
// (`proximoVencimentoEm`) e se há check-ins que ainda precisam de nova
// tentativa (`haPendentes`). Este serviço é a única regra de negócio.
import type { HandoffRepository } from './repository'
import type { RegistroHandoff } from './types'
import {
  processarNotificacaoGrupo,
  MAX_TENTATIVAS_NOTIFICACAO,
  type DepsNotificacaoGrupo,
  type ResultadoNotificacaoGrupo,
} from '../notificacoes/grupoComercial'
import { descreverTempoDecorrido } from '../notificacoes/mensagens'
import type { DadosAlertaHandoff, NotificacaoHandoff } from '../notificacoes/types'
import { gerarCodigoRef } from '../grupo/comandos'
import { CodigoRefEmUsoError } from '../notificacoes/repository'

export const TIPO_CHECKIN = 'handoff_checkin' as const
export const LIMITE_HANDOFFS_POR_CICLO = 50
const TENTATIVAS_CODIGO = 5

export interface DepsAcompanhamento {
  handoff: HandoffRepository
  notificacoes: DepsNotificacaoGrupo
  // Janela de revisão da organização, em minutos (config; padrão 7 dias).
  lerJanelaMinutos: (organizacaoId: string) => Promise<number>
  // Relógio injetável (testes). Padrão: agora.
  agora?: () => Date
  // Sorteio do código de referência (testes usam sequência fixa).
  aleatorio?: () => number
}

export type ResultadoCheckin =
  | { handoffId: string; tipo: 'enviado'; notificacao: NotificacaoHandoff }
  | { handoffId: string; tipo: 'ja_enviado' }
  | { handoffId: string; tipo: 'pendente'; motivo: 'falhou' | 'configuracao_ausente' | 'incerta' | 'esgotada' | 'concorrente'; erro?: string }
  // A mensagem ficaria incorreta: sem responsável ativo na org, ou lead sumiu.
  | { handoffId: string; tipo: 'ignorado'; motivo: 'responsavel_invalido' | 'lead_invalido' }

export interface ResumoAcompanhamento {
  organizacaoId: string
  janelaMinutos: number
  abertos: number
  vencidos: number
  enviados: number
  jaEnviados: number
  pendentes: number
  ignorados: number
  resultados: ResultadoCheckin[]
  // Próximo instante em que um handoff aberto SEM check-in concluído vence a
  // janela (null = nada a esperar). É o que diz ao scheduler quando acordar.
  proximoVencimentoEm: string | null
  // Há check-in vencido que ainda precisa de nova tentativa (Z-API fora, grupo
  // sem config, perdeu a corrida)? O scheduler volta mais cedo.
  haPendentes: boolean
}

// Instante-limite: handoffs atribuídos ATÉ este ponto já venceram a janela.
export function limiteRevisao(agora: Date, janelaMinutos: number): string {
  return new Date(agora.getTime() - janelaMinutos * 60_000).toISOString()
}

// Datas chegam como ISO do PostgREST ("+00:00", microssegundos) ou como Date
// do driver pg: comparar por epoch, nunca como texto.
const epoch = (v: string | Date | null | undefined) => (v == null ? NaN : new Date(v).getTime())
const inicioDe = (h: RegistroHandoff) => epoch(h.atribuidoEm ?? h.criadoEm)

function vencimentoDe(h: RegistroHandoff, janelaMinutos: number): string {
  return new Date(inicioDe(h) + janelaMinutos * 60_000).toISOString()
}

function mapearResultadoNotificacao(handoffId: string, r: ResultadoNotificacaoGrupo): ResultadoCheckin {
  switch (r.tipo) {
    case 'enviada': return { handoffId, tipo: 'enviado', notificacao: r.notificacao }
    case 'ja_enviada': return { handoffId, tipo: 'ja_enviado' }
    case 'falhou': return { handoffId, tipo: 'pendente', motivo: 'falhou', erro: r.erro }
    case 'configuracao_ausente': return { handoffId, tipo: 'pendente', motivo: 'configuracao_ausente' }
    case 'incerta': return { handoffId, tipo: 'pendente', motivo: 'incerta' }
    case 'esgotada': return { handoffId, tipo: 'pendente', motivo: 'esgotada' }
    case 'concorrente': return { handoffId, tipo: 'pendente', motivo: 'concorrente' }
    case 'nao_encontrada': return { handoffId, tipo: 'pendente', motivo: 'concorrente' }
  }
}

// Check-in que já chegou a um estado final (não volta a ser tentado aqui).
function checkinConcluido(n: NotificacaoHandoff | null | undefined): boolean {
  return !!n && (n.status === 'enviada' || n.status === 'enviando' || n.tentativas >= MAX_TENTATIVAS_NOTIFICACAO)
}

/**
 * Um ciclo de acompanhamento para UMA organização. Idempotente: rodar de novo
 * não manda segunda pergunta (a intenção existente responde 'ja_enviada').
 */
export async function processarAcompanhamentoHandoff(
  deps: DepsAcompanhamento,
  organizacaoId: string,
): Promise<ResumoAcompanhamento> {
  const agora = (deps.agora ?? (() => new Date()))()
  const janelaMinutos = await deps.lerJanelaMinutos(organizacaoId)
  const resumo: ResumoAcompanhamento = {
    organizacaoId, janelaMinutos, abertos: 0, vencidos: 0, enviados: 0, jaEnviados: 0, pendentes: 0, ignorados: 0,
    resultados: [], proximoVencimentoEm: null, haPendentes: false,
  }

  // Uma leitura serve às duas perguntas: quem já venceu (processar agora) e
  // quando o próximo vence (dormir até lá). Mais antigos primeiro, então o
  // limite por ciclo nunca esconde o mais urgente.
  const abertos = await deps.handoff.listarAbertos(organizacaoId, LIMITE_HANDOFFS_POR_CICLO)
  resumo.abertos = abertos.length
  if (abertos.length === 0) return resumo

  // Check-ins que já existem para estes handoffs: enviados/presos/esgotados são
  // pulados sem tocar o outbox (evita reler cada handoff antigo a cada ciclo).
  const existentes = new Map(
    (await deps.notificacoes.repo.listarPorHandoffs(organizacaoId, TIPO_CHECKIN, abertos.map((h) => h.id)))
      .map((n) => [n.handoffId, n]),
  )

  const limite = epoch(limiteRevisao(agora, janelaMinutos))
  const vencidos = abertos.filter((h) => inicioDe(h) <= limite)
  resumo.vencidos = vencidos.length

  // Próximo a vencer entre os que ainda não venceram e não têm check-in concluído.
  const futuros = abertos
    .filter((h) => inicioDe(h) > limite && !checkinConcluido(existentes.get(h.id)))
    .map((h) => vencimentoDe(h, janelaMinutos))
    .sort()
  resumo.proximoVencimentoEm = futuros[0] ?? null
  if (vencidos.length === 0) return resumo

  // Nome do responsável: mesma leitura do rodízio (comerciais ativos da org).
  const comerciais = new Map((await deps.handoff.listarDistribuicao(organizacaoId)).map((c) => [c.usuarioId, c]))

  for (const h of vencidos) {
    const r = await processarUm(deps, organizacaoId, h, existentes.get(h.id) ?? null, comerciais, agora)
    resumo.resultados.push(r)
    if (r.tipo === 'enviado') resumo.enviados++
    else if (r.tipo === 'ja_enviado') resumo.jaEnviados++
    else if (r.tipo === 'pendente') {
      resumo.pendentes++
      // Retentáveis: o scheduler volta mais cedo. 'incerta'/'esgotada' não.
      if (r.motivo === 'falhou' || r.motivo === 'configuracao_ausente' || r.motivo === 'concorrente') resumo.haPendentes = true
    } else resumo.ignorados++
    // Sem grupo configurado nada mais sai neste ciclo — não insiste nos demais.
    if (r.tipo === 'pendente' && r.motivo === 'configuracao_ausente') break
  }
  return resumo
}

async function processarUm(
  deps: DepsAcompanhamento,
  org: string,
  h: RegistroHandoff,
  existente: NotificacaoHandoff | null,
  comerciais: Map<string, { nome: string }>,
  agora: Date,
): Promise<ResultadoCheckin> {
  if (existente) {
    if (existente.status === 'enviada') return { handoffId: h.id, tipo: 'ja_enviado' }
    if (existente.status === 'enviando') return { handoffId: h.id, tipo: 'pendente', motivo: 'incerta' }
    if (existente.tentativas >= MAX_TENTATIVAS_NOTIFICACAO) return { handoffId: h.id, tipo: 'pendente', motivo: 'esgotada' }
    // pendente/falhou/configuracao_ausente: tenta entregar de novo (mesma linha).
    return mapearResultadoNotificacao(h.id, await processarNotificacaoGrupo(deps.notificacoes, org, existente.id))
  }

  // Intenção nova: os dados são congelados AGORA (responsável, lead, tempo).
  const comercial = h.responsavelId ? comerciais.get(h.responsavelId) : undefined
  if (!comercial?.nome) return { handoffId: h.id, tipo: 'ignorado', motivo: 'responsavel_invalido' }
  const lead = await deps.handoff.buscarLead(org, h.leadId)
  if (!lead) return { handoffId: h.id, tipo: 'ignorado', motivo: 'lead_invalido' }

  const dados: DadosAlertaHandoff = {
    empresa: lead.empresa,
    contato: lead.contatoNome,
    responsavelNome: comercial.nome,
    motivo: h.motivo ?? 'round_robin',
    etapaCadencia: '',
    tempoEmContato: descreverTempoDecorrido(new Date(inicioDe(h)).toISOString(), agora.toISOString()),
  }
  // Código curto único por org (Fase 4): colisão no índice → sorteia outro.
  let intencao: NotificacaoHandoff | null = null
  for (let i = 0; i < TENTATIVAS_CODIGO && !intencao; i++) {
    try {
      intencao = await deps.notificacoes.repo.registrarIntencao(org, h.id, TIPO_CHECKIN, dados, { codigoRef: gerarCodigoRef(deps.aleatorio) })
    } catch (e) {
      if (!(e instanceof CodigoRefEmUsoError) || i === TENTATIVAS_CODIGO - 1) throw e
    }
  }
  if (!intencao) throw new Error('não foi possível registrar a intenção do check-in')
  return mapearResultadoNotificacao(h.id, await processarNotificacaoGrupo(deps.notificacoes, org, intencao.id))
}
