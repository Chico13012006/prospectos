import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gerarJsonEstruturado: vi.fn() }))

// A camada central é substituída: aqui importa só O QUE a funcionalidade envia
// e como normaliza a resposta, independentemente do provider.
vi.mock('../jsonEstruturado', () => ({ gerarJsonEstruturado: mocks.gerarJsonEstruturado }))

import { gerarInsightComercial } from '../insightComercial'

// Cópias literais do prompt e do schema de antes da migração para a camada
// central: se mudarem, este teste precisa quebrar.
const SISTEMA_ORIGINAL =
  'Você é um SDR sênior da iNOVACODE, que vende automação de estoque com RFID (coletores, impressoras, totens, PDV e mesa de conferência) para varejo, óticas, hotelaria, indústria e afins. A partir dos dados de um lead, produza uma leitura comercial CURTA, específica e acionável — sem enrolação, sem repetir os dados de entrada. Escreva em português do Brasil. Cada campo com no máximo 2 frases. Se os dados forem escassos, seja honesto e generalize com cautela (não invente fatos sobre a empresa).'

const PERGUNTA_ORIGINAL =
  'Responda: aderência (alta/media/baixa) do lead à nossa solução, a oportunidade concreta, a dor provável do negócio e a abordagem sugerida para o primeiro contato.'

const SCHEMA_ORIGINAL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    aderencia: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    oportunidade: { type: 'string' },
    dor: { type: 'string' },
    abordagem: { type: 'string' },
  },
  required: ['aderencia', 'oportunidade', 'dor', 'abordagem'],
}

beforeEach(() => {
  mocks.gerarJsonEstruturado.mockReset()
  mocks.gerarJsonEstruturado.mockResolvedValue({ aderencia: 'alta', oportunidade: 'o', dor: 'd', abordagem: 'a' })
})

describe('gerarInsightComercial — via camada central de IA', () => {
  it('envia exatamente o prompt, o schema e o limite de antes', async () => {
    await gerarInsightComercial({
      empresa: 'Ótica Exemplo',
      segmento: 'óticas',
      cidade: 'Campinas',
      estado: 'SP',
      faixa_funcionarios: null,
      contato_cargo: 'Gerente de loja',
      canal_preferencial: 'email',
      estagio: 'novo',
    })

    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledTimes(1)
    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledWith({
      papel: 'insight',
      system: SISTEMA_ORIGINAL,
      user:
        'Lead:\n- Empresa: Ótica Exemplo\n- Segmento/nicho: óticas\n- Cidade/UF: Campinas/SP\n' +
        '- Cargo do contato: Gerente de loja\n- Canal preferencial: email\n- Estágio atual: novo\n\n' +
        PERGUNTA_ORIGINAL,
      schema: SCHEMA_ORIGINAL,
      nomeSchema: 'insight_comercial',
      maxTokens: 700,
    })
  })

  it('lead sem dados estruturados mantém o aviso de poucos dados', async () => {
    await gerarInsightComercial({})
    expect(mocks.gerarJsonEstruturado.mock.calls[0][0].user).toBe(
      'Lead:\n- (poucos dados estruturados disponíveis)\n\n' + PERGUNTA_ORIGINAL,
    )
  })

  it('normaliza a resposta como antes', async () => {
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({
      aderencia: 'altíssima',
      oportunidade: '  Reduzir inventário manual.  ',
      dor: '',
    })
    await expect(gerarInsightComercial({ empresa: 'Ótica Exemplo' })).resolves.toEqual({
      aderencia: 'media',
      oportunidade: 'Reduzir inventário manual.',
      dor: '—',
      abordagem: '—',
    })

    mocks.gerarJsonEstruturado.mockResolvedValueOnce({ aderencia: 'baixa', oportunidade: 'o', dor: 'd', abordagem: 'a' })
    await expect(gerarInsightComercial({ empresa: 'Ótica Exemplo' })).resolves.toEqual({
      aderencia: 'baixa',
      oportunidade: 'o',
      dor: 'd',
      abordagem: 'a',
    })
  })

  it('falha da camada central propaga para a rota (que responde 500)', async () => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('Resposta da OpenAI incompleta (max_output_tokens).'))
    await expect(gerarInsightComercial({ empresa: 'Ótica Exemplo' })).rejects.toThrow('incompleta')
  })
})
