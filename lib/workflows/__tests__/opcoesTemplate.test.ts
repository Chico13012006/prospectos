// O campo `template` do bloco "Enviar e-mail" lista os templates da organização
// (carregados em runtime), não uma lista fixa.
import { describe, expect, it } from 'vitest'
import { acharBlocoDef, opcoesDeTemplate, type CampoDef } from '../catalogo'

const campoTemplate = acharBlocoDef('enviar_email')!.campos.find((c) => c.nome === 'template')!

describe('opções do campo de template', () => {
  it('o bloco enviar_email pede a lista dinâmica e mantém o formato { template: tipo }', () => {
    expect(campoTemplate.opcoesDinamicas).toBe('templates')
    expect(campoTemplate.tipo).toBe('select')
    expect(campoTemplate.padrao).toBe('follow_up_1')
  })

  it('usa os templates da organização, com nome e chave, sem repetir a chave', () => {
    const opcoes = opcoesDeTemplate(campoTemplate, [
      { nome: 'Reativação T1', tipo: 'reativacao_1' },
      { nome: 'Reativação T1 (variante)', tipo: 'reativacao_1' },
      { nome: 'Renovação', tipo: 'renovacao_1' },
    ], 'reativacao_1')
    expect(opcoes).toEqual([
      { valor: 'reativacao_1', label: 'Reativação T1 · reativacao_1' },
      { valor: 'renovacao_1', label: 'Renovação · renovacao_1' },
    ])
  })

  it('o valor já gravado que não está mais na organização aparece marcado, sem sumir', () => {
    const opcoes = opcoesDeTemplate(campoTemplate, [{ nome: 'Renovação', tipo: 'renovacao_1' }], 'teste_antigo')
    expect(opcoes[0]).toEqual({ valor: 'teste_antigo', label: 'teste_antigo — não encontrado nesta organização' })
    expect(opcoes).toHaveLength(2)
  })

  it('organização sem templates não inventa opções', () => {
    expect(opcoesDeTemplate(campoTemplate, [], '')).toEqual([])
  })

  it('campos comuns continuam com as opções do catálogo', () => {
    const campo: CampoDef = { nome: 'estagio', label: 'Status', tipo: 'select', padrao: 'x', opcoes: [{ valor: 'x', label: 'X' }] }
    expect(opcoesDeTemplate(campo, [{ nome: 'T', tipo: 't' }], 'x')).toEqual([{ valor: 'x', label: 'X' }])
  })
})
