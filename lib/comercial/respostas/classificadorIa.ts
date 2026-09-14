// Implementação Claude (Haiku) do ClassificadorIa — SERVER-ONLY. Mesmo padrão
// de lib/ia/contatosAlternativos: saída estruturada por json_schema, texto
// truncado, e NUNCA lança (null = não conseguiu classificar).
import 'server-only'
import { getIaClient, iaConfigurada, MODELO_INSIGHT } from '@/lib/ia/cliente'
import type { ClassificadorIa, RespostaParaClassificar } from './classificarResposta'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classificacao: { type: 'string', enum: ['positivo', 'negativo', 'neutro'] },
    justificativa: { type: 'string' },
  },
  required: ['classificacao', 'justificativa'],
} as const

const SISTEMA =
  'Você classifica a resposta de um contato a uma abordagem comercial por e-mail (prospecção B2B). ' +
  'Responda com UMA classificação:\n' +
  '- "positivo": demonstra interesse em conversar, pede mais informações, proposta, reunião, ' +
  'preço, demonstração, ou indica a pessoa certa para tratar do assunto com abertura.\n' +
  '- "negativo": recusa, não tem interesse, pede para parar de receber, diz que já tem fornecedor ' +
  'e não quer avaliar, ou responde com hostilidade.\n' +
  '- "neutro": não dá para saber (pergunta o que é sem sinal de interesse, responde outra coisa, ' +
  'encaminhamento sem opinião, "vou ver depois" sem compromisso).\n' +
  'Na dúvida entre positivo e neutro, escolha neutro. Não invente contexto.'

export function criarClassificadorIa(): ClassificadorIa | null {
  if (!iaConfigurada()) return null
  return async (resposta: RespostaParaClassificar) => {
    try {
      const client = getIaClient()
      const texto = `Assunto: ${resposta.assunto.slice(0, 300)}\n\nResposta:\n${resposta.corpo.slice(0, 4000)}`
      const resp = await client.messages.create({
        model: MODELO_INSIGHT,
        max_tokens: 200,
        system: SISTEMA,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: texto }],
      })
      const bloco = resp.content.find((b) => b.type === 'text')
      const raw = bloco && bloco.type === 'text' ? bloco.text : '{}'
      const dados = JSON.parse(raw) as { classificacao?: unknown }
      const c = dados.classificacao
      return c === 'positivo' || c === 'negativo' || c === 'neutro' ? c : null
    } catch {
      return null
    }
  }
}
