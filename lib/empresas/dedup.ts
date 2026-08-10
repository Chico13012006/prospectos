// Deduplicação de empresas a partir de leads — política CONSERVADORA aprovada.
// Determinística e pura (testável). Regras:
//
//   AUTO-MERGE só em alta confiança:
//     1) CNPJ normalizado igual (autoritativo)
//     2) nome normalizado + domínio de empresa (e-mail não-pessoal) iguais
//   NUNCA faz merge por nome isolado nem por domínio isolado.
//
//   Casos ambíguos ficam SEPARADOS (empresa própria) e marcados para revisão:
//     - domínio compartilhado por nomes distintos (possível filial/variação)
//     - nome repetido sem domínio para confirmar identidade
//
// A saída é um "plano": para cada lead, a CHAVE da empresa (leads com a mesma
// chave = a mesma empresa), o método e a marcação de revisão. O runner do
// backfill materializa isso (find-or-create empresa + 1 contato por lead).
import { normalizarCnpj } from './cnpj'

// Provedores pessoais: e-mail nesses domínios NÃO é sinal de empresa.
const PROVEDORES_PESSOAIS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br',
  'icloud.com', 'live.com', 'bol.com.br', 'uol.com.br', 'terra.com.br',
  'msn.com', 'ig.com.br', 'globo.com', 'me.com',
])

// Nome de empresa em forma canônica p/ igualdade: minúsculas, sem acento,
// só alfanumérico separado por espaço. NÃO remove sufixos jurídicos (ltda/me/sa)
// de propósito — removê-los arriscaria fundir empresas distintas (conservador).
export function normalizarNomeEmpresa(nome: unknown): string {
  return String(nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos (range combinante explícito)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Domínio "de empresa" a partir do e-mail (null p/ provedor pessoal ou sem @).
export function dominioEmpresa(email: unknown): string | null {
  const d = String(email ?? '').split('@')[1]?.toLowerCase()?.trim()
  if (!d || PROVEDORES_PESSOAIS.has(d)) return null
  return d
}

export interface LeadEntrada {
  id: string
  empresa: string | null
  contato_email: string | null
  cnpj?: string | null
}

export type MetodoEmpresa = 'cnpj' | 'nome_dominio' | 'isolado'

export interface PlanoLead {
  leadId: string
  empresaChave: string
  nome: string // nome de exibição (original do 1º lead da chave, preenchido pelo runner)
  nomeNormalizado: string
  cnpj: string | null
  dominio: string | null
  metodo: MetodoEmpresa
  revisaoPendente: boolean
  motivoRevisao: string | null
}

// Gera o plano de dedup para um conjunto de leads (de UMA organização).
export function planejarDedup(leads: LeadEntrada[]): PlanoLead[] {
  // Pré-cálculo dos sinais por lead.
  const sig = leads.map((l) => ({
    id: l.id,
    cnpj: normalizarCnpj(l.cnpj),
    dominio: dominioEmpresa(l.contato_email),
    nn: normalizarNomeEmpresa(l.empresa),
  }))

  // Chave da empresa por lead (define quem mescla com quem).
  const chaveDe = (s: { id: string; cnpj: string | null; dominio: string | null; nn: string }): { chave: string; metodo: MetodoEmpresa } => {
    if (s.cnpj) return { chave: `cnpj:${s.cnpj}`, metodo: 'cnpj' }
    if (s.dominio) return { chave: `nd:${s.nn}|${s.dominio}`, metodo: 'nome_dominio' }
    return { chave: `iso:${s.id}`, metodo: 'isolado' } // nunca mescla por nome/domínio isolado
  }

  // Índices p/ flags de ambiguidade.
  const nomesPorDominio = new Map<string, Set<string>>() // dominio -> nomes distintos
  const chavesPorNome = new Map<string, Set<string>>() // nome -> chaves distintas
  for (const s of sig) {
    const { chave } = chaveDe(s)
    if (s.dominio) {
      if (!nomesPorDominio.has(s.dominio)) nomesPorDominio.set(s.dominio, new Set())
      nomesPorDominio.get(s.dominio)!.add(s.nn)
    }
    if (!chavesPorNome.has(s.nn)) chavesPorNome.set(s.nn, new Set())
    chavesPorNome.get(s.nn)!.add(chave)
  }

  return sig.map((s) => {
    const { chave, metodo } = chaveDe(s)
    let revisaoPendente = false
    let motivoRevisao: string | null = null

    if (metodo === 'nome_dominio') {
      const nomes = nomesPorDominio.get(s.dominio!) ?? new Set()
      if (nomes.size > 1) {
        revisaoPendente = true
        motivoRevisao = `Domínio "${s.dominio}" compartilhado por nomes distintos (possível filial/variação): ${[...nomes].join(' | ')}`
      }
    } else if (metodo === 'isolado') {
      const chaves = chavesPorNome.get(s.nn) ?? new Set()
      if (s.nn && chaves.size > 1) {
        revisaoPendente = true
        motivoRevisao = 'Nome repetido sem domínio de empresa para confirmar identidade (possível mesma empresa ou homônimo).'
      }
    }
    // metodo 'cnpj' é autoritativo → nunca marca revisão.

    return {
      leadId: s.id,
      empresaChave: chave,
      nome: '',
      nomeNormalizado: s.nn,
      cnpj: s.cnpj,
      dominio: s.dominio,
      metodo,
      revisaoPendente,
      motivoRevisao,
    }
  })
}
