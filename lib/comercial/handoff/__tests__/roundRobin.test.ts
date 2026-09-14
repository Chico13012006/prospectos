import { describe, it, expect } from 'vitest'
import { ordenarRodizio, proximoDoRodizio } from '../roundRobin'

const c = (usuarioId: string, nome: string, participa = true) => ({ usuarioId, nome, participa })

// Ordem estável: Bruno < Guilherme < Silmara (nome pt-BR, sem caixa/acento).
const BRUNO = c('u-bruno', 'Bruno')
const SILMARA = c('u-silmara', 'Silmara')
const GUILHERME = c('u-guilherme', 'Guilherme')
const TODOS = [SILMARA, GUILHERME, BRUNO] // embaralhado de propósito

describe('roundRobin — ordem estável', () => {
  it('ordena por nome (pt-BR, insensível a caixa/acento) e desempata por id', () => {
    const ordem = ordenarRodizio([c('b', 'ana'), c('a', 'Ana'), c('z', 'Álvaro'), c('m', 'bruno')])
    expect(ordem.map((x) => x.usuarioId)).toEqual(['z', 'a', 'b', 'm'])
  })
})

describe('roundRobin — próximo', () => {
  it('cursor vazio → primeiro da ordem', () => {
    expect(proximoDoRodizio(TODOS, null)?.usuarioId).toBe('u-bruno')
  })

  it('gira Bruno → Guilherme → Silmara → Bruno', () => {
    let ultimo: string | null = null
    const seq: string[] = []
    for (let i = 0; i < 6; i++) {
      const p: { usuarioId: string; nome: string } | null = proximoDoRodizio(TODOS, ultimo)
      if (!p) throw new Error('rodízio vazio')
      seq.push(p.nome)
      ultimo = p.usuarioId
    }
    expect(seq).toEqual(['Bruno', 'Guilherme', 'Silmara', 'Bruno', 'Guilherme', 'Silmara'])
  })

  it('participante fora do rodízio é pulado, mesmo sendo o próximo', () => {
    const lista = [BRUNO, c('u-guilherme', 'Guilherme', false), SILMARA]
    expect(proximoDoRodizio(lista, 'u-bruno')?.usuarioId).toBe('u-silmara')
    expect(proximoDoRodizio(lista, 'u-silmara')?.usuarioId).toBe('u-bruno')
  })

  it('último saiu do rodízio → o seguinte a ele na ordem, não o primeiro', () => {
    // Guilherme foi o último e entrou de férias: o próximo é Silmara (depois
    // dele), não Bruno.
    const lista = [BRUNO, c('u-guilherme', 'Guilherme', false), SILMARA]
    expect(proximoDoRodizio(lista, 'u-guilherme')?.usuarioId).toBe('u-silmara')
  })

  it('último não existe mais na lista → primeiro participante', () => {
    expect(proximoDoRodizio(TODOS, 'u-removido')?.usuarioId).toBe('u-bruno')
  })

  it('ninguém participa → null', () => {
    expect(proximoDoRodizio([c('a', 'A', false), c('b', 'B', false)], null)).toBeNull()
    expect(proximoDoRodizio([], null)).toBeNull()
  })

  it('um único participante → sempre ele', () => {
    const lista = [c('u-bruno', 'Bruno', false), SILMARA, c('u-guilherme', 'Guilherme', false)]
    expect(proximoDoRodizio(lista, null)?.usuarioId).toBe('u-silmara')
    expect(proximoDoRodizio(lista, 'u-silmara')?.usuarioId).toBe('u-silmara')
  })

  it('é determinístico e não muta a entrada', () => {
    const entrada = [...TODOS]
    const a = proximoDoRodizio(entrada, 'u-bruno')
    const b = proximoDoRodizio(entrada, 'u-bruno')
    expect(a).toEqual(b)
    expect(entrada).toEqual(TODOS)
  })
})
