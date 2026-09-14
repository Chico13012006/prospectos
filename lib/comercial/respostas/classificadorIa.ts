// Implementação do ClassificadorIa sobre a camada central de IA (papel
// "insight", provider conforme AI_PROVIDER) — SERVER-ONLY. Mesmo padrão de
// lib/ia/contatosAlternativos: saída estruturada por json_schema, texto
// truncado, e NUNCA lança (null = não conseguiu classificar).
import 'server-only'
import { iaConfigurada } from '@/lib/ia/cliente'
import { gerarJsonEstruturado } from '@/lib/ia/jsonEstruturado'
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

// AI_PROVIDER inválido faz iaConfigurada() lançar; aqui isso vira "IA não
// configurada" (→ indeterminado, sem handoff) para não derrubar a detecção.
function iaDisponivel(): boolean {
  try {
    return iaConfigurada()
  } catch {
    return false
  }
}

export function criarClassificadorIa(): ClassificadorIa | null {
  if (!iaDisponivel()) return null
  return async (resposta: RespostaParaClassificar) => {
    try {
      const texto = `Assunto: ${resposta.assunto.slice(0, 300)}\n\nResposta:\n${resposta.corpo.slice(0, 4000)}`
      const dados = (await gerarJsonEstruturado({
        papel: 'insight',
        system: SISTEMA,
        user: texto,
        schema: SCHEMA,
        nomeSchema: 'classificacao_resposta',
        maxTokens: 200,
      })) as { classificacao?: unknown }
      const c = dados.classificacao
      return c === 'positivo' || c === 'negativo' || c === 'neutro' ? c : null
    } catch {
      return null
    }
  }
}
