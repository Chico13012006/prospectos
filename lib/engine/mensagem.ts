// Seleção do template de E-MAIL pelo motor + preenchimento de variáveis.
// Regra (master): escolhe por (segmento + estágio). No primeiro contato, um lead
// com nicho exige template ativo daquele nicho; não pode cair silenciosamente
// no genérico. Follow-ups continuam usando o template genérico compartilhado.
//
// Threading: o assunto do follow-up NÃO sai da própria linha — o motor deriva
// "Re: " do assunto do 1º contato do MESMO lead (mesmo nicho/genérico), mantendo
// a thread. LinkedIn/WhatsApp/Telefone são manuais; o motor nunca os lê aqui.
import type { Lead } from './types'
import type { Store } from './store/store'
import { formatarDataIsoSemFuso } from '@/lib/servicos/vencimento'
import { normalizarNicho } from '@/lib/nichos/normalizar'

export { normalizarNicho } from '@/lib/nichos/normalizar'

export interface Envio {
  tipo: 'abordagem' | 'follow_up'
  // Nº do follow-up (1-based). Só quando tipo === 'follow_up'.
  numero?: number
}

// Estágio do funil → `tipo` da tabela de templates.
// Item 3: MESMO template/tom em TODAS as 8 etapas de follow-up (confirmado com o
// Chico). O motor usa sempre o `follow_up_1` — o número (envio.numero) só define
// o ESPAÇAMENTO da cadência (dias), nunca o conteúdo. follow_up_2/3/4 continuam
// na tabela mas o motor não os seleciona mais (evita, por ex., repetir o
// "última mensagem" do follow_up_4 nas etapas 5-8).
function tipoTemplate(envio: Envio): string {
  if (envio.tipo === 'abordagem') return 'primeiro_contato'
  return 'follow_up_1'
}

function primeiroNome(nomeCompleto?: string | null): string {
  return (nomeCompleto ?? '').trim().split(/\s+/)[0] || ''
}

// Substitui as variáveis do template pelos dados do lead e limpa resíduos de
// campos vazios (ex.: "Olá , tudo bem?" → "Olá, tudo bem?").
// `extras` injeta variáveis de nível-org (ex.: {nome_servico}) sem alterar a
// assinatura dos chamadores que só têm acesso ao lead.
export function preencher(texto: string, lead: Lead, extras?: Record<string, string>): string {
  const valores: Record<string, string> = {
    nome: primeiroNome(lead.contato_nome),
    empresa: lead.empresa?.trim() || 'sua empresa',
    segmento: lead.segmento?.trim() || 'seu setor',
    cidade: lead.cidade?.trim() || '',
    responsavel_comercial: lead.usuarios?.nome || lead.responsavel_nome || 'Francisco',
    data_validade: formatarDataIsoSemFuso(lead.data_validade),
    ...extras,
  }
  return texto
    .replace(/\{(\w+)\}/g, (m, chave: string) => (chave in valores ? valores[chave] : m))
    .replace(/Olá ,/g, 'Olá,')
    .replace(/,\s*\./g, '.')
    .replace(/ {2,}/g, ' ')
}

// A/B testing (item 6): escolhe UMA variante entre as ativas, de forma
// determinística por lead. Assim toda a cadência do lead usa a MESMA variante
// (consistência de thread + a resposta é atribuída a ela) e a distribuição entre
// leads fica equilibrada. Hash simples e estável do id do lead.
export function indiceVariante(seed: string, n: number): number {
  if (n <= 1) return 0
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % n
}

// Monta o e-mail final (assunto + corpo) pela variante selecionada, com fallback
// para o genérico. Devolve o `templateId` da variante usada (gravado na interação
// p/ o A/B). Lança se nem o genérico do estágio existir (config incompleta).
export async function montarEmail(
  store: Store,
  lead: Lead,
  envio: Envio,
): Promise<{ assunto: string; corpo: string; templateId: string }> {
  const nicho = normalizarNicho(lead.segmento)
  const tipo = tipoTemplate(envio)

  // Primeiro contato: exige variante do nicho quando o lead o possui. Follow-up:
  // tenta o nicho e pode cair no genérico compartilhado do mesmo estágio.
  const variantesNicho = nicho ? await store.buscarTemplateEmail(nicho, tipo) : []
  if (envio.tipo === 'abordagem' && nicho && variantesNicho.length === 0) {
    throw new Error(`Template de primeiro contato ausente para o nicho '${nicho}'.`)
  }
  const variantes = variantesNicho.length ? variantesNicho : await store.buscarTemplateEmail(null, tipo)
  if (variantes.length === 0) {
    throw new Error(`Template de e-mail ausente (tipo=${tipo}, nicho=${nicho ?? 'generico'}).`)
  }
  const idx = indiceVariante(lead.id, variantes.length)
  const tpl = variantes[idx]

  // Assunto: 1º contato usa o próprio; follow-up deriva "Re:" do primeiro_contato
  // do lead (mesmo nicho/genérico), na MESMA variante (mesmo idx, clampado).
  let assuntoRaw: string
  if (envio.tipo === 'abordagem') {
    assuntoRaw = tpl.assunto ?? '{empresa} + iNOVACODE'
  } else {
    const baseNicho = nicho ? await store.buscarTemplateEmail(nicho, 'primeiro_contato') : []
    const bases = baseNicho.length ? baseNicho : await store.buscarTemplateEmail(null, 'primeiro_contato')
    const base = bases.length ? bases[Math.min(idx, bases.length - 1)] : null
    assuntoRaw = `Re: ${base?.assunto ?? '{empresa}'}`
  }

  return { assunto: preencher(assuntoRaw, lead), corpo: preencher(tpl.corpo, lead), templateId: tpl.id }
}
