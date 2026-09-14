// Gatilho da Fase 2: resposta POSITIVA de prospecção → handoff (Fase 1) →
// intenção de aviso ao grupo → tentativa de envio. Chamado pelo motor
// (detectarResposta) DEPOIS de registrar a resposta e encerrar a cadência.
//
// Ordem e falhas parciais:
//   1. handoff no banco (atômico, idempotente por eventoId) — fonte da verdade;
//   2. intenção de notificação (idempotente por handoff+tipo);
//   3. envio ao grupo (recuperável: falha vira 'falhou'/'configuracao_ausente'
//      no outbox; nunca desfaz o handoff, nunca reavança o cursor).
// Reprocessar o mesmo evento repete 1–3 sem efeito novo: 'ja_processado' +
// intenção já existente + 'ja_enviada'. Se o processo morreu entre 1 e 2, a
// repetição registra a intenção que faltou (o handoff já existia).
import { atribuirResponsavelHandoff } from './handoffService'
import type { HandoffRepository } from './repository'
import type { ResultadoHandoff } from './types'
import {
  processarNotificacaoGrupo,
  registrarAlertaGrupo,
  type DepsNotificacaoGrupo,
  type ResultadoNotificacaoGrupo,
} from '../notificacoes/grupoComercial'
import type { DadosAlertaHandoff } from '../notificacoes/types'

export interface DepsGatilhoProspeccao {
  handoff: HandoffRepository
  notificacoes: DepsNotificacaoGrupo
  // Fase 3: acorda o scheduler comercial da org quando nasce um handoff (a
  // corrente de check-in começa aqui). Best-effort: falhar não desfaz nada —
  // o cron diário do domínio re-semeia a corrente.
  agendarAcompanhamento?: (organizacaoId: string) => Promise<unknown>
}

export interface EntradaGatilhoProspeccao {
  organizacaoId: string
  leadId: string
  // Identidade estável da resposta (Message-ID do e-mail) — idempotência.
  eventoId: string
  empresa: string
  contatoNome: string
  // Texto pronto: "primeiro contato", "follow-up 2", 'campanha "X"'.
  etapaCadencia: string
}

export interface ResponsavelHandoff {
  id: string
  nome: string
  email: string | null
}

export interface ResultadoGatilhoProspeccao {
  handoff: ResultadoHandoff
  // Responsável atual do lead após o handoff (para o aviso ao closer do motor).
  responsavel: ResponsavelHandoff | null
  notificacao: ResultadoNotificacaoGrupo | null
}

export async function processarRespostaPositivaProspeccao(
  deps: DepsGatilhoProspeccao,
  entrada: EntradaGatilhoProspeccao,
): Promise<ResultadoGatilhoProspeccao> {
  const { organizacaoId: org } = entrada
  const handoff = await atribuirResponsavelHandoff(deps.handoff, {
    organizacaoId: org,
    leadId: entrada.leadId,
    eventoId: entrada.eventoId,
    origem: 'prospeccao',
  })

  // Sem responsável não há o que avisar: aguardando distribuição fica
  // registrado no handoff (recuperável); lead de outra org / conflito idem.
  if (handoff.tipo !== 'atribuido' && handoff.tipo !== 'ja_processado' && handoff.tipo !== 'ja_em_contato_comercial') {
    return { handoff, responsavel: null, notificacao: null }
  }
  const registro = handoff.handoff
  if (!registro.responsavelId) return { handoff, responsavel: null, notificacao: null }

  // Nome/e-mail do responsável: listarDistribuicao já traz os comerciais
  // ativos da org (é a mesma leitura do rodízio — sem query nova).
  const comerciais = await deps.handoff.listarDistribuicao(org)
  const comercial = comerciais.find((c) => c.usuarioId === registro.responsavelId)
  const responsavel: ResponsavelHandoff = {
    id: registro.responsavelId,
    nome: comercial?.nome || (handoff.tipo === 'atribuido' ? handoff.responsavel.nome : ''),
    email: comercial?.email ?? null,
  }

  const dados: DadosAlertaHandoff = {
    empresa: entrada.empresa,
    contato: entrada.contatoNome,
    responsavelNome: responsavel.nome,
    motivo: registro.motivo ?? 'round_robin',
    etapaCadencia: entrada.etapaCadencia,
  }
  const intencao = await registrarAlertaGrupo(deps.notificacoes, org, registro.id, dados)
  const notificacao = await processarNotificacaoGrupo(deps.notificacoes, org, intencao.id)

  if (handoff.tipo === 'atribuido' && deps.agendarAcompanhamento) {
    try {
      await deps.agendarAcompanhamento(org)
    } catch (e) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(), nivel: 'aviso', escopo: 'comercial.handoff',
        msg: 'Não foi possível agendar o acompanhamento do handoff (o cron diário re-semeia).',
        organizacaoId: org, handoffId: registro.id, erro: e instanceof Error ? e.message : String(e),
      }))
    }
  }
  return { handoff, responsavel, notificacao }
}
