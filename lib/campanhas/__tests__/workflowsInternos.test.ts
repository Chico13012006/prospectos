import { describe, it, expect } from 'vitest'
import {
  apenasWorkflowsAutorais,
  apenasTemplatesAutorais,
  ehTemplateDeCampanha,
} from '../workflowsInternos'

describe('apenasWorkflowsAutorais', () => {
  const workflows = [
    { id: 'w1', nome: 'Reativação de clientes (Laudos)' },
    { id: 'w2', nome: 'Campanha — Prospecção Piloto' },
    { id: 'w3', nome: 'Renovação semestral' },
  ]

  it('esconde os workflows vinculados a uma campanha', () => {
    const visiveis = apenasWorkflowsAutorais(workflows, ['w2'])
    expect(visiveis.map((w) => w.id)).toEqual(['w1', 'w3'])
  })

  it('usa o vínculo real, não o nome — workflow autoral chamado "Campanha — …" fica', () => {
    const visiveis = apenasWorkflowsAutorais(workflows, [])
    expect(visiveis).toHaveLength(3)
  })

  it('id de campanha que não corresponde a nenhum workflow não remove nada', () => {
    expect(apenasWorkflowsAutorais(workflows, ['inexistente'])).toHaveLength(3)
  })

  it('lista vazia continua vazia', () => {
    expect(apenasWorkflowsAutorais([], ['w1'])).toEqual([])
  })
})

describe('templates gerados por campanha', () => {
  it('reconhece pelo prefixo do tipo', () => {
    expect(ehTemplateDeCampanha('campanha_36b37f83_m1')).toBe(true)
    expect(ehTemplateDeCampanha('abordagem')).toBe(false)
    expect(ehTemplateDeCampanha('renovacao_1')).toBe(false)
    expect(ehTemplateDeCampanha(null)).toBe(false)
    expect(ehTemplateDeCampanha(undefined)).toBe(false)
  })

  it('mantém a biblioteca autoral e remove os materializados', () => {
    const templates = [
      { id: '1', tipo: 'abordagem' },
      { id: '2', tipo: 'campanha_abc_m1' },
      { id: '3', tipo: 'renovacao_1' },
      { id: '4', tipo: 'campanha_abc_m2' },
    ]
    expect(apenasTemplatesAutorais(templates).map((t) => t.id)).toEqual(['1', '3'])
  })
})
