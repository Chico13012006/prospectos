// Máquina de estados do funil + montagem de mensagem.
// Vocabulário de estágio é o DESTE projeto (igual à UI do pipeline).
// Em produção dá para puxar o corpo da tabela `templates` do Supabase; aqui
// usamos templates embutidos (puros e testáveis) com a tese comercial do lead.
import type { Lead, Estagio, TipoInteracaoEngine } from './types'

// Estágios em que o lead está "na esteira" e pode receber follow-up.
export const ESTAGIOS_EM_CADENCIA: Estagio[] = [
  'primeiro_contato',
  'aguardando_resposta',
  'follow_up',
]

// A partir do estágio atual, qual estágio o lead assume DEPOIS do próximo envio.
export function proximoEstagio(atual: string): Estagio {
  const mapa: Record<string, Estagio> = {
    novos_leads: 'primeiro_contato',
    primeiro_contato: 'follow_up',
    aguardando_resposta: 'follow_up',
    follow_up: 'follow_up',
  }
  return mapa[atual] ?? (atual as Estagio)
}

// É o primeiro contato (abordagem) ou um follow-up?
export function tipoDoEnvio(estagioAtual: string): TipoInteracaoEngine {
  return estagioAtual === 'novos_leads' ? 'abordagem' : 'follow_up'
}

// Domínio "de empresa" do lead: a coluna dominio se existir, senão o domínio do
// contato_email (ignora provedores pessoais comuns, que não casam empresa).
const PROVEDORES_PESSOAIS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
])

export function dominioDoLead(lead: Pick<Lead, 'dominio' | 'contato_email'>): string | null {
  if (lead.dominio) return lead.dominio.toLowerCase()
  const d = lead.contato_email?.split('@')[1]?.toLowerCase()
  if (!d || PROVEDORES_PESSOAIS.has(d)) return null
  return d
}

export function montarMensagem(
  lead: Lead,
  estagioDestino: Estagio,
): { assunto: string; corpo: string } {
  const nome = lead.contato_nome?.split(' ')[0] || 'tudo bem'
  const tese =
    lead.tese_comercial?.trim() ||
    `acredito que faz sentido conversarmos sobre ${lead.segmento || 'o seu setor'}`

  switch (estagioDestino) {
    case 'primeiro_contato':
      return {
        assunto: `${lead.empresa} + iNOVACODE`,
        corpo: `Olá ${nome}, ${tese}. Faz sentido uma conversa rápida de 15 minutos?\n\nAbraço,\nFrancisco | iNOVACODE`,
      }
    case 'follow_up':
      return {
        assunto: `Re: ${lead.empresa} + iNOVACODE`,
        corpo: `Olá ${nome}, só retomando meu contato anterior — conseguiu dar uma olhada? Se for o momento, te mostro em 15 minutos como ajudamos empresas parecidas.\n\nAbraço,\nFrancisco | iNOVACODE`,
      }
    default:
      return {
        assunto: `${lead.empresa} + iNOVACODE`,
        corpo: `Olá ${nome}.`,
      }
  }
}
