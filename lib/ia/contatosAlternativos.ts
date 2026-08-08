// Extração de contato(s) alternativo(s) de um auto-reply de ausência/férias
// (sprint item 7). Respostas de "estou de férias, fale com Fulano" têm texto
// livre e variado — por isso usamos a IA (Haiku, barato) em vez de regex rígido,
// validando cada e-mail com regex antes de confiar. SERVER-ONLY.
//
// v1 NÃO auto-cadastra: o motor só registra uma SUGESTÃO no lead para o
// comercial revisar (ver lib/engine/flows/detectarResposta.ts).
import { getIaClient, MODELO_INSIGHT } from './cliente'

export interface ContatoAlternativo {
  nome: string
  email: string
}

// Regex de e-mail deliberadamente simples: só descarta lixo óbvio. A IA já traz
// o par nome+e-mail; aqui é a rede de segurança contra alucinação de endereço.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contatos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nome: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nome', 'email'],
      },
    },
  },
  required: ['contatos'],
} as const

const SISTEMA =
  'Você extrai contatos alternativos de e-mails automáticos de ausência/férias. ' +
  'Esses e-mails costumam indicar com quem falar durante a ausência do titular ' +
  '("na minha ausência, fale com Fulano, fulano@empresa.com"). Extraia SOMENTE ' +
  'pares de nome + e-mail de pessoas/setores indicados como contato alternativo. ' +
  'NÃO invente e-mails: se um nome aparecer sem e-mail, ignore-o. NÃO inclua o ' +
  'próprio remetente ausente. Se não houver nenhum contato alternativo claro, ' +
  'retorne a lista vazia.'

// Extrai os contatos alternativos do corpo do auto-reply. Nunca lança: em
// qualquer falha (IA indisponível, JSON inválido) devolve [] — a extração é um
// bônus, não pode derrubar o fluxo de detecção de resposta.
export async function extrairContatosAlternativos(corpo: string): Promise<ContatoAlternativo[]> {
  const texto = (corpo ?? '').trim()
  if (!texto) return []
  try {
    const client = getIaClient()
    const resp = await client.messages.create({
      model: MODELO_INSIGHT,
      max_tokens: 500,
      system: SISTEMA,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: `E-mail automático recebido:\n\n${texto.slice(0, 4000)}` }],
    })
    const bloco = resp.content.find((b) => b.type === 'text')
    const raw = bloco && bloco.type === 'text' ? bloco.text : '{}'
    const dados = JSON.parse(raw) as { contatos?: Array<{ nome?: unknown; email?: unknown }> }
    const contatos = Array.isArray(dados.contatos) ? dados.contatos : []
    // Normaliza + valida: e-mail obrigatório e plausível; dedupe por e-mail.
    const vistos = new Set<string>()
    const saida: ContatoAlternativo[] = []
    for (const c of contatos) {
      const email = String(c.email ?? '').trim().toLowerCase()
      const nome = String(c.nome ?? '').trim()
      if (!EMAIL_RE.test(email) || vistos.has(email)) continue
      vistos.add(email)
      saida.push({ nome: nome || email, email })
    }
    return saida
  } catch {
    return []
  }
}
