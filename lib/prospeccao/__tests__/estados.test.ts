import { describe, expect, it } from 'vitest'
import { UFS_BRASIL } from '@/lib/config/workspaceConfig'
import { filtrarEstados, NOME_UF } from '@/lib/prospeccao/estados'

describe('filtrarEstados', () => {
  it('todo estado tem nome', () => {
    expect(UFS_BRASIL.every((uf) => !!NOME_UF[uf])).toBe(true)
  })

  it('sem texto devolve os 27, em ordem de nome', () => {
    const todos = filtrarEstados('  ')
    expect(todos).toHaveLength(27)
    expect(todos[0]).toBe('AC')
    expect(todos.at(-1)).toBe('TO')
  })

  it('sigla exata vem primeiro, depois nomes que começam e que contêm o texto', () => {
    expect(filtrarEstados('pa')).toEqual(['PA', 'PB', 'PR', 'AP', 'SP'])
  })

  it('ignora acento e maiúscula', () => {
    expect(filtrarEstados('PARANA')).toEqual(['PR'])
    expect(filtrarEstados('sao')).toEqual(['SP'])
    expect(filtrarEstados('espirito')).toEqual(['ES'])
  })

  it('texto sem correspondência devolve lista vazia', () => {
    expect(filtrarEstados('xyz')).toEqual([])
  })
})
