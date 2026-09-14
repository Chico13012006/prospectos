import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gerarJsonEstruturado: vi.fn() }))

vi.mock('../jsonEstruturado', () => ({ gerarJsonEstruturado: mocks.gerarJsonEstruturado }))

import { extrairContatosAlternativos } from '../contatosAlternativos'

// Cópias literais do prompt e do schema de antes da migração: se mudarem, quebra.
const SISTEMA_ORIGINAL =
  'Você extrai contatos alternativos de e-mails automáticos de ausência/férias. ' +
  'Esses e-mails costumam indicar com quem falar durante a ausência do titular ' +
  '("na minha ausência, fale com Fulano, fulano@empresa.com"). Extraia SOMENTE ' +
  'pares de nome + e-mail de pessoas/setores indicados como contato alternativo. ' +
  'NÃO invente e-mails: se um nome aparecer sem e-mail, ignore-o. NÃO inclua o ' +
  'próprio remetente ausente. Se não houver nenhum contato alternativo claro, ' +
  'retorne a lista vazia.'

const SCHEMA_ORIGINAL = {
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
}

beforeEach(() => {
  mocks.gerarJsonEstruturado.mockReset()
  mocks.gerarJsonEstruturado.mockResolvedValue({ contatos: [] })
})

describe('extrairContatosAlternativos — via camada central de IA', () => {
  it('corpo vazio devolve [] sem chamar a IA', async () => {
    await expect(extrairContatosAlternativos('   ')).resolves.toEqual([])
    expect(mocks.gerarJsonEstruturado).not.toHaveBeenCalled()
  })

  it('envia o prompt, o schema e o limite de antes, com o corpo aparado e truncado', async () => {
    const corpo = `  Estou de férias. ${'x'.repeat(5000)}  `
    await extrairContatosAlternativos(corpo)

    expect(mocks.gerarJsonEstruturado).toHaveBeenCalledWith({
      papel: 'insight',
      system: SISTEMA_ORIGINAL,
      user: `E-mail automático recebido:\n\n${corpo.trim().slice(0, 4000)}`,
      schema: SCHEMA_ORIGINAL,
      nomeSchema: 'contatos_alternativos',
      maxTokens: 500,
    })
  })

  it('valida e-mail por regex, normaliza, deduplica e usa o e-mail quando falta nome', async () => {
    mocks.gerarJsonEstruturado.mockResolvedValueOnce({
      contatos: [
        { nome: ' Maria Exemplo ', email: ' Maria@Empresa-Ficticia.com ' },
        { nome: 'Duplicada', email: 'maria@empresa-ficticia.com' },
        { nome: 'Sem e-mail', email: '' },
        { nome: 'Lixo', email: 'nao-e-email' },
        { nome: '', email: 'suporte@empresa-ficticia.com' },
      ],
    })
    await expect(extrairContatosAlternativos('Estou ausente até segunda.')).resolves.toEqual([
      { nome: 'Maria Exemplo', email: 'maria@empresa-ficticia.com' },
      { nome: 'suporte@empresa-ficticia.com', email: 'suporte@empresa-ficticia.com' },
    ])
  })

  it('qualquer falha da camada (recusa, incompleta, sem chave) devolve [] sem lançar', async () => {
    mocks.gerarJsonEstruturado.mockRejectedValueOnce(new Error('OpenAI recusou gerar a resposta estruturada.'))
    await expect(extrairContatosAlternativos('Estou ausente.')).resolves.toEqual([])

    mocks.gerarJsonEstruturado.mockResolvedValueOnce({ contatos: 'não é lista' })
    await expect(extrairContatosAlternativos('Estou ausente.')).resolves.toEqual([])
  })
})
