// Seleção do template de E-MAIL pelo motor + preenchimento de variáveis.
// Regra (master): escolhe por (segmento + estágio). Se o lead tem nicho e existe
// template do nicho, usa; senão cai no GENÉRICO do mesmo estágio. Follow-ups são
// genéricos (não há template de nicho) e, por isso, sempre caem no genérico.
//
// Threading: o assunto do follow-up NÃO sai da própria linha — o motor deriva
// "Re: " do assunto do 1º contato do MESMO lead (mesmo nicho/genérico), mantendo
// a thread. LinkedIn/WhatsApp/Telefone são manuais; o motor nunca os lê aqui.
import type { Lead } from './types'
import type { Store } from './store/store'
import { NICHOS } from './templates-seed'

export interface Envio {
  tipo: 'abordagem' | 'follow_up'
  // Nº do follow-up (1-based). Só quando tipo === 'follow_up'.
  numero?: number
}

// Maior nº de follow-up com template próprio (follow_up_1..3). Acima disso, cap.
const MAX_TIPO_FOLLOWUP = 3

// Sinônimos de segmento (free-text do lead) → chave canônica de nicho. A maioria
// dos nichos já casa direto pelo nome (oticas, varejo, ...); aqui ficam só os
// apelidos que não batem 1:1. Tudo passa antes por remoção de acento + lowercase.
const SINONIMOS_NICHO: Record<string, (typeof NICHOS)[number]> = {
  otica: 'oticas',
  relojoaria: 'oticas',
  hotel: 'hotelaria',
  hoteis: 'hotelaria',
  turismo: 'hotelaria',
  comercio: 'varejo',
  loja: 'varejo',
  lojas: 'varejo',
  saude: 'hospital',
  hospitalar: 'hospital',
  clinica: 'hospital',
  industrial: 'industria',
  manufatura: 'industria',
  fabrica: 'industria',
  alimenticio: 'alimentos',
  alimenticia: 'alimentos',
  bebidas: 'alimentos',
}

function canonizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

// free-text segmento → chave de nicho canônica, ou null (= genérico).
export function normalizarNicho(segmento?: string | null): string | null {
  if (!segmento) return null
  const k = canonizar(segmento)
  if (!k) return null
  if ((NICHOS as readonly string[]).includes(k)) return k
  return SINONIMOS_NICHO[k] ?? null
}

// Estágio do funil → `tipo` da tabela de templates.
function tipoTemplate(envio: Envio): string {
  if (envio.tipo === 'abordagem') return 'primeiro_contato'
  const n = Math.min(Math.max(envio.numero ?? 1, 1), MAX_TIPO_FOLLOWUP)
  return `follow_up_${n}`
}

function primeiroNome(nomeCompleto?: string | null): string {
  return (nomeCompleto ?? '').trim().split(/\s+/)[0] || ''
}

// Substitui as variáveis do template pelos dados do lead e limpa resíduos de
// campos vazios (ex.: "Olá , tudo bem?" → "Olá, tudo bem?").
export function preencher(texto: string, lead: Lead): string {
  const valores: Record<string, string> = {
    nome: primeiroNome(lead.contato_nome),
    empresa: lead.empresa?.trim() || 'sua empresa',
    segmento: lead.segmento?.trim() || 'seu setor',
    cidade: lead.cidade?.trim() || '',
    responsavel_comercial: lead.usuarios?.nome || lead.responsavel_nome || 'Francisco',
  }
  return texto
    .replace(/\{(\w+)\}/g, (m, chave: string) => (chave in valores ? valores[chave] : m))
    .replace(/Olá ,/g, 'Olá,')
    .replace(/,\s*\./g, '.')
    .replace(/ {2,}/g, ' ')
}

// Monta o e-mail final (assunto + corpo) pelo template selecionado, com fallback
// para o genérico. Lança se nem o genérico do estágio existir (config incompleta).
export async function montarEmail(
  store: Store,
  lead: Lead,
  envio: Envio,
): Promise<{ assunto: string; corpo: string }> {
  const nicho = normalizarNicho(lead.segmento)
  const tipo = tipoTemplate(envio)

  // Corpo: tenta o nicho, cai no genérico do MESMO estágio.
  const tpl =
    (nicho ? await store.buscarTemplateEmail(nicho, tipo) : null) ??
    (await store.buscarTemplateEmail(null, tipo))
  if (!tpl) {
    throw new Error(`Template de e-mail ausente (tipo=${tipo}, nicho=${nicho ?? 'generico'}).`)
  }

  // Assunto: 1º contato usa o próprio; follow-up deriva "Re:" do 1º contato do
  // lead (mesmo nicho/genérico) para threadar.
  let assuntoRaw: string
  if (envio.tipo === 'abordagem') {
    assuntoRaw = tpl.assunto ?? '{empresa} + iNOVACODE'
  } else {
    const base =
      (nicho ? await store.buscarTemplateEmail(nicho, 'primeiro_contato') : null) ??
      (await store.buscarTemplateEmail(null, 'primeiro_contato'))
    assuntoRaw = `Re: ${base?.assunto ?? '{empresa}'}`
  }

  return { assunto: preencher(assuntoRaw, lead), corpo: preencher(tpl.corpo, lead) }
}
