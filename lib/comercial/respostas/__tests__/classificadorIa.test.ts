import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  iaConfigurada: vi.fn(),
  gerarJsonEstruturado: vi.fn(),
}))

// Camada central substituída: nenhum provider real, nenhuma classificação real.
vi.mock('@/lib/ia/cliente', () => ({ iaConfigurada: mocks.iaConfigurada }))
vi.mock('@/lib/ia/jsonEstruturado', () => ({ gerarJsonEstruturado: mocks.gerarJsonEstruturado }))

import { criarClassificadorIa } from '../classificadorIa'
import { classificarResposta } from '../classificarResposta'

// Cópias literais do prompt e do schema de antes da migração: se mudarem, quebra.
const SISTEMA_ORIGINAL =
  'Você classifica a resposta de um contato a uma abordagem comercial por e-mail (prospecção B2B). ' +
  'Responda com UMA classificação:\n' +
  '- "positivo": demonstra interesse em conversar, pede mais informações, proposta, reunião, ' +
  'preço, demonstração, ou indica a pessoa certa para tratar do assunto com abertura.\n' +
  '- "negativo": recusa, não tem interesse, pede para parar de receber, diz que já tem fornecedor ' +
  'e não quer avaliar, ou responde com hostilidade.\n' +
  '- "neutro": não dá para saber (pergunta o que é sem sinal de interesse, responde outra coisa, ' +
  'encaminhamento sem opinião, "vou ver depois" sem compromisso).\n' +
  'Na dúvida entre positivo e neutro, escolha neutro. Não invente contexto.'

const SCHEMA_ORIGINAL = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classificacao: { type: 'string', enum: ['positivo', 'negativo', 'neutro'] },
    justificativa: { type: 'string' },
  },
  required: ['classificacao', 'justificativa'],
}

beforeEach(() => {
  mocks.iaConfigurada.mockReset()
  mocks.iaConfigurada.mockReturnValue(true)
  mocks.gerarJsonEstruturado.mockReset()
  mocks.gerarJsonEstruturado.mockResolvedValue({ classificacao: 'neutro', justificativa: 'sem sinal' })
})

describe('criarClassificadorIa — via camada central de IA', () => {
  it('IA não configurada → null (motor segue sem classificador, como antes)', () => {
    mocks.iaConfigurada.mockReturnValue(false)
    expect(criarClassificadorIa()).toBeNull()
  })

  it('AI_PROVIDER inválido não derruba a detecção: vira null', () => {
    mocks.iaConfigurada.mockImplementation(() => { throw new Error('AI_PROVIDER inválido: "x"') })
    expect(criarClassificadorIa()).toBeNull()
  })

  it('envia o prompt, o schema e o limite de antes, com assunto e corpo truncados', async () => {
    const ia = criarClassificadorIa()!
    await ia({ assunto: 'A'.repeat(400), corpo: 'B'.repeat(5000) })

    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledWith({
      papel: 'insight',
      system: SISTEMA_ORIGINAL,
      user: `Assunto: ${'A'.repeat(300)}\n\nResposta:\n${'B'.repeat(4000)}`,
      schema: SCHEMA_ORIGINAL,
      nomeSchema: 'classificacao_resposta',
      maxTokens: 200,
    })
  })

  it.each(['positivo', 'negativo', 'neutro'] as const)('devolve "%s" vindo da IA', async (classificacao) => {
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({ classificacao, justificativa: 'x' })
    await expect(criarClassificadorIa()!({ assunto: 'Re: contato', corpo: 'Texto.' })).resolves.toBe(classificacao)
  })

  it('classificação fora do enum ou falha da camada → null, nunca lança', async () => {
    const ia = criarClassificadorIa()!
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({ classificacao: 'talvez', justificativa: 'x' })
    await expect(ia({ assunto: 'Re', corpo: 'Texto.' })).resolves.toBeNull()

    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('Resposta da OpenAI incompleta (max_output_tokens).'))
    await expect(ia({ assunto: 'Re', corpo: 'Texto.' })).resolves.toBeNull()
  })
})

describe('classificarResposta com o classificador real (camada mockada)', () => {
  it('regra fixa de recusa decide antes da IA', async () => {
    const r = await classificarResposta({ assunto: 'Re: proposta', corpo: 'Não tenho interesse, obrigado.' }, criarClassificadorIa())
    expect(r).toEqual({ classificacao: 'negativo', via: 'regra', motivo: 'recusa/opt-out explícito' })
    expect(mocks.gerarJsonEstruturado).not.toHaveBeenCalled()
  })

  it('resposta ambígua vai para a IA; falha da IA vira indeterminado (sem handoff)', async () => {
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({ classificacao: 'positivo', justificativa: 'pediu reunião' })
    await expect(
      classificarResposta({ assunto: 'Re: contato', corpo: 'Podemos marcar uma conversa semana que vem?' }, criarClassificadorIa()),
    ).resolves.toEqual({ classificacao: 'positivo', via: 'ia' })

    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('falha simulada'))
    const r = await classificarResposta({ assunto: 'Re: contato', corpo: 'Vou ver depois.' }, criarClassificadorIa())
    expect(r.classificacao).toBe('indeterminado')
    expect(r.via).toBe('indisponivel')
  })

  it('IA não configurada → indeterminado com motivo explícito', async () => {
    mocks.iaConfigurada.mockReturnValue(false)
    await expect(
      classificarResposta({ assunto: 'Re: contato', corpo: 'Podemos conversar?' }, criarClassificadorIa()),
    ).resolves.toEqual({ classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA não configurada' })
  })
})
