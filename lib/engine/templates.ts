// Máquina de estados do funil + montagem de mensagem.
// Vocabulário de estágio é o DESTE projeto (igual à UI do pipeline).
// Em produção dá para puxar o corpo da tabela `templates` do Supabase; aqui
// usamos templates embutidos (puros e testáveis) com a tese comercial do lead.
import type { Lead, Estagio } from './types'

// Estágios "iniciais" (lead ainda não contatado). Aceita os dois vocabulários
// presentes no banco: 'novos_leads' (UI deste projeto) e 'novo' (legado/referência).
export const ESTAGIOS_INICIAIS = ['novos_leads', 'novo']

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
    novo: 'primeiro_contato',
    primeiro_contato: 'follow_up',
    aguardando_resposta: 'follow_up',
    follow_up: 'follow_up',
  }
  return mapa[atual] ?? (atual as Estagio)
}

// É o primeiro contato (abordagem) ou um follow-up?
export function tipoDoEnvio(estagioAtual: string): 'abordagem' | 'follow_up' {
  return ESTAGIOS_INICIAIS.includes(estagioAtual) ? 'abordagem' : 'follow_up'
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

// A montagem de mensagem (seleção de template por nicho/estágio + preenchimento
// de variáveis + threading de assunto) vive agora em lib/engine/mensagem.ts, que
// lê os templates da tabela `templates` via Store (fonte única, editável na UI).
