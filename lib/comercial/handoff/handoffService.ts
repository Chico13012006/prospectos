// Orquestração do handoff comercial. Regras aqui; dados no repository; escolha
// do rodízio em roundRobin. API routes, React e cron só chamam estas funções.
//
// atribuirResponsavelHandoff:
//   1. lead precisa existir NESTA organização;
//   2. mesmo evento já concluído → nada muda (idempotente);
//   3. lead já em contato comercial (outro evento) → não redistribui;
//   4. responsável histórico preservável (veio de handoff anterior e segue
//      ativo na org) → reativação: preserva, NÃO avança o cursor;
//   5. senão → round-robin entre os participantes; sem participante →
//      registro pendente ("aguardando distribuição"), recuperável depois.
//
// Concorrência: a decisão (4/5) é tomada sobre uma leitura; a confirmação no
// banco é atômica e recusa decisões feitas sobre estado velho
// ('conflito_cursor') ou sobre alguém que saiu no meio ('participante_
// inelegivel'). Nesses dois casos nada foi gravado e o serviço redecide com
// estado fresco, até MAX_TENTATIVAS. Dois leads que respondem no mesmo
// instante recebem comerciais DIFERENTES, na sequência.
import type { DecisaoHandoff, HandoffRepository, ResultadoConfirmacao } from './repository'
import { proximoDoRodizio } from './roundRobin'
import { origemHandoffValida, type EntradaHandoff, type ResultadoHandoff } from './types'

export const MAX_TENTATIVAS_HANDOFF = 5

function validarEntrada(entrada: EntradaHandoff): void {
  if (!entrada.organizacaoId?.trim()) throw new Error('handoff: organizacaoId é obrigatório')
  if (!entrada.leadId?.trim()) throw new Error('handoff: leadId é obrigatório')
  if (!entrada.eventoId?.trim()) throw new Error('handoff: eventoId é obrigatório (identidade do evento)')
  if (!origemHandoffValida(entrada.origem)) throw new Error(`handoff: origem inválida (${String(entrada.origem)})`)
}

function mapearConfirmacao(
  r: ResultadoConfirmacao,
  decisao: DecisaoHandoff,
  nomeResponsavel: string | null,
): ResultadoHandoff | null {
  switch (r.resultado) {
    case 'confirmado':
      return {
        tipo: 'atribuido',
        motivo: r.handoff.motivo ?? decisao.motivo ?? 'round_robin',
        primeiraAtribuicao: r.handoff.primeiraAtribuicao ?? decisao.primeiraAtribuicao ?? true,
        responsavel: { id: r.handoff.responsavelId ?? decisao.responsavelId ?? '', nome: nomeResponsavel ?? '' },
        handoff: r.handoff,
      }
    case 'aguardando_distribuicao':
      return { tipo: 'aguardando_distribuicao', handoff: r.handoff }
    case 'ja_processado':
      return { tipo: 'ja_processado', handoff: r.handoff }
    case 'ja_em_contato_comercial':
      return { tipo: 'ja_em_contato_comercial', handoff: r.handoff }
    case 'lead_nao_encontrado':
      return { tipo: 'lead_nao_encontrado' }
    // Nada foi gravado: a decisão envelheceu entre a leitura e a confirmação.
    case 'conflito_cursor':
    case 'participante_inelegivel':
      return null
  }
}

export async function atribuirResponsavelHandoff(
  repo: HandoffRepository,
  entrada: EntradaHandoff,
): Promise<ResultadoHandoff> {
  validarEntrada(entrada)
  const { organizacaoId: org, leadId } = entrada

  const lead = await repo.buscarLead(org, leadId)
  if (!lead) return { tipo: 'lead_nao_encontrado' }

  // Checagem barata antes de decidir. A confirmação repete sob lock — esta só
  // evita trabalho (e leitura do cursor) no caso comum de evento repetido.
  const aberto = await repo.buscarHandoffAberto(org, leadId)
  if (aberto?.status === 'em_contato_comercial') {
    return aberto.eventoId === entrada.eventoId
      ? { tipo: 'ja_processado', handoff: aberto }
      : { tipo: 'ja_em_contato_comercial', handoff: aberto }
  }

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_HANDOFF; tentativa++) {
    const historico = await repo.buscarHistorico(org, leadId)

    let decisao: DecisaoHandoff
    let nome: string | null = null
    if (historico.responsavelPreservavel) {
      // Reativação: preserva quem já era o comercial. Cursor intacto.
      decisao = {
        responsavelId: historico.responsavelPreservavel.usuarioId,
        motivo: 'reativacao',
        primeiraAtribuicao: false,
        cursorVersaoEsperada: null,
      }
      nome = historico.responsavelPreservavel.nome
    } else {
      const [comerciais, cursor] = await Promise.all([repo.listarDistribuicao(org), repo.lerCursor(org)])
      const escolhido = proximoDoRodizio(comerciais, cursor.ultimoUsuarioId)
      if (!escolhido) {
        decisao = { responsavelId: null, motivo: null, primeiraAtribuicao: null, cursorVersaoEsperada: null }
      } else {
        decisao = {
          responsavelId: escolhido.usuarioId,
          motivo: 'round_robin',
          primeiraAtribuicao: !historico.jaTeveAtribuicao,
          cursorVersaoEsperada: cursor.versao,
        }
        nome = escolhido.nome
      }
    }

    const confirmacao = await repo.confirmar(entrada, decisao)
    const resultado = mapearConfirmacao(confirmacao, decisao, nome)
    if (resultado) return resultado
    // Retentável: redecide com estado fresco.
  }
  return { tipo: 'conflito_concorrencia' }
}

// --- Configuração dos participantes (tela Configurações > Distribuição) -----

export async function listarDistribuicaoComercial(repo: HandoffRepository, organizacaoId: string) {
  return repo.listarDistribuicao(organizacaoId)
}

export async function definirParticipacaoComercial(
  repo: HandoffRepository,
  organizacaoId: string,
  usuarioId: string,
  participa: boolean,
): Promise<'ok' | 'usuario_nao_encontrado'> {
  if (!usuarioId?.trim()) throw new Error('handoff: usuarioId é obrigatório')
  return repo.definirParticipacao(organizacaoId, usuarioId, participa)
}
