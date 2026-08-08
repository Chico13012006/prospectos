// Insight comercial por lead (item 4 — bloco "Inteligência Comercial" do painel).
// Gera, via Claude (Haiku, barato), uma leitura curta e acionável do lead:
// aderência à solução (RFID/automação de estoque da iNOVACODE), oportunidade,
// dor provável e abordagem sugerida. SERVER-ONLY.
import { getIaClient, MODELO_INSIGHT } from './cliente'

export type Aderencia = 'alta' | 'media' | 'baixa'

export interface InsightComercial {
  aderencia: Aderencia
  oportunidade: string
  dor: string
  abordagem: string
}

// Dados mínimos do lead que alimentam o prompt (subconjunto de Lead).
export interface LeadParaInsight {
  empresa?: string | null
  segmento?: string | null
  cidade?: string | null
  estado?: string | null
  faixa_funcionarios?: string | null
  contato_cargo?: string | null
  canal_preferencial?: string | null
  estagio?: string | null
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aderencia: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    oportunidade: { type: 'string' },
    dor: { type: 'string' },
    abordagem: { type: 'string' },
  },
  required: ['aderencia', 'oportunidade', 'dor', 'abordagem'],
} as const

function resumoLead(lead: LeadParaInsight): string {
  const linhas = [
    ['Empresa', lead.empresa],
    ['Segmento/nicho', lead.segmento],
    ['Cidade/UF', [lead.cidade, lead.estado].filter(Boolean).join('/')],
    ['Porte (funcionários)', lead.faixa_funcionarios],
    ['Cargo do contato', lead.contato_cargo],
    ['Canal preferencial', lead.canal_preferencial],
    ['Estágio atual', lead.estagio],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
  return linhas.length ? linhas.join('\n') : '- (poucos dados estruturados disponíveis)'
}

const SISTEMA =
  'Você é um SDR sênior da iNOVACODE, que vende automação de estoque com RFID ' +
  '(coletores, impressoras, totens, PDV e mesa de conferência) para varejo, ' +
  'óticas, hotelaria, indústria e afins. A partir dos dados de um lead, produza ' +
  'uma leitura comercial CURTA, específica e acionável — sem enrolação, sem ' +
  'repetir os dados de entrada. Escreva em português do Brasil. Cada campo com no ' +
  'máximo 2 frases. Se os dados forem escassos, seja honesto e generalize com ' +
  'cautela (não invente fatos sobre a empresa).'

export async function gerarInsightComercial(lead: LeadParaInsight): Promise<InsightComercial> {
  const client = getIaClient()
  const resp = await client.messages.create({
    model: MODELO_INSIGHT,
    max_tokens: 700,
    system: SISTEMA,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content:
          `Lead:\n${resumoLead(lead)}\n\n` +
          'Responda: aderência (alta/media/baixa) do lead à nossa solução, a ' +
          'oportunidade concreta, a dor provável do negócio e a abordagem sugerida ' +
          'para o primeiro contato.',
      },
    ],
  })

  const bloco = resp.content.find((b) => b.type === 'text')
  const texto = bloco && bloco.type === 'text' ? bloco.text : '{}'
  const dados = JSON.parse(texto) as InsightComercial
  return {
    aderencia: (['alta', 'media', 'baixa'] as const).includes(dados.aderencia) ? dados.aderencia : 'media',
    oportunidade: dados.oportunidade?.trim() || '—',
    dor: dados.dor?.trim() || '—',
    abordagem: dados.abordagem?.trim() || '—',
  }
}
