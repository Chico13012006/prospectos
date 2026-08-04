// Mapeamento ESPECÍFICO do CSV do HubSpot BR (colunas em português tipo
// "E-mail", "Associated Company", "Proprietário do contato"). Fica num módulo
// SEM efeito colateral (não roda `main`) para que tanto o importador
// (importar-hubspot.ts) quanto o popular-responsavel.ts possam reusar `mapearLead`
// sem disparar a importação. O parser CSV e a validação de e-mail vêm do módulo
// compartilhado — nada de duplicar parseCSV/regex aqui.
import { emailValido } from '../lib/leads/importarCsv'

// Provedores de e-mail PESSOAL: o prefixo do domínio NÃO é nome de empresa.
const PROVEDORES_PESSOAIS = new Set([
  'gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live', 'bol', 'uol', 'terra', 'msn', 'aol',
])

// "tribecaeventos" -> "Tribeca Eventos" (só para domínios corporativos).
function tituloCase(s: string): string {
  return s
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export interface HubspotLead {
  empresa: string
  responsavel_nome: string | null
  cidade: null
  estado: null
  segmento: null
  site: null
  linkedin: null
  contato_nome: string | null
  contato_cargo: null
  contato_email: string
  contato_telefone: string | null
  canal_preferencial: 'email'
  origem: 'hubspot'
  hubspot_id: string | null
  estagio: 'perdido' | 'novos_leads'
  perdido: boolean
  perdido_motivo: string | null
  score: number
}

// Mapeamento para as colunas REAIS da tabela `leads` no Supabase.
export function mapearLead(row: Record<string, string>): HubspotLead | null {
  const email = (row['E-mail'] || row['Email'] || '').trim().toLowerCase()
  // Sem e-mail válido (mesma regex do módulo compartilhado) → fora da importação.
  if (!emailValido(email)) return null

  const nome = row['Nome'] || ''
  const sobrenome = row['Sobrenome'] || ''
  const fullName = [nome, sobrenome].filter(Boolean).join(' ').trim() || null

  const prefixoDominio = (email.split('@')[1] || '').split('.')[0] || ''
  const associada = (row['Associated Company'] || '').trim()
  const ehPessoal = PROVEDORES_PESSOAIS.has(prefixoDominio)

  // Empresa: NUNCA fabricar a partir de domínio pessoal.
  let empresa: string
  let perdido = false
  let perdidoMotivo: string | null = null
  if (associada) {
    empresa = associada
  } else if (!ehPessoal) {
    empresa = tituloCase(prefixoDominio)
  } else {
    empresa = '(sem empresa)'
    perdido = true
    perdidoMotivo = 'import: e-mail pessoal, sem empresa'
  }

  const telefone = (row['Número de telefone'] || '').trim().replace(/[^\d+]/g, '') || null
  const hubspotId = (row['ID do registro.'] || row['ID do registro'] || '').trim() || null
  const responsavelNome = (row['Proprietário do contato'] || '').trim() || null

  return {
    empresa,
    responsavel_nome: responsavelNome,
    cidade: null,
    estado: null,
    segmento: null,
    site: null,
    linkedin: null,
    contato_nome: fullName,
    contato_cargo: null,
    contato_email: email,
    contato_telefone: telefone,
    canal_preferencial: 'email',
    origem: 'hubspot',
    hubspot_id: hubspotId,
    estagio: perdido ? 'perdido' : 'novos_leads',
    perdido,
    perdido_motivo: perdidoMotivo,
    score: 50,
  }
}
