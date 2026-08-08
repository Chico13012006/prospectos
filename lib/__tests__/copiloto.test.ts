import { describe, it, expect } from 'vitest'
import { normalizarAnalise } from '../ia/copilotoReuniao'

describe('copiloto — normalizarAnalise', () => {
  it('descarta equipamento fora do vocabulário e força quantidade >= 1', () => {
    const r = normalizarAnalise({
      resumo: 'ok',
      equipamentos: [
        { produto: 'coletor', quantidade: 3 },
        { produto: 'drone', quantidade: 2 }, // inválido → descartado
        { produto: 'pdv', quantidade: 0 }, // qtd inválida → vira 1
      ],
    })
    expect(r.equipamentos).toEqual([
      { produto: 'coletor', quantidade: 3 },
      { produto: 'pdv', quantidade: 1 },
    ])
  })

  it('só aceita estágio dentro do enum; senão null', () => {
    expect(normalizarAnalise({ estagioSugerido: 'reuniao_agendada' }).estagioSugerido).toBe('reuniao_agendada')
    expect(normalizarAnalise({ estagioSugerido: 'inventado' }).estagioSugerido).toBeNull()
    expect(normalizarAnalise({ estagioSugerido: '' }).estagioSugerido).toBeNull()
  })

  it('coage listas e strings ausentes para vazio (nunca undefined)', () => {
    const r = normalizarAnalise({})
    expect(r.resumo).toBe('')
    expect(r.dores).toEqual([])
    expect(r.objecoes).toEqual([])
    expect(r.equipamentos).toEqual([])
    expect(r.proximoFollowup).toBe('')
    expect(r.emailCorpo).toBe('')
  })

  it('limpa entradas em branco das listas', () => {
    const r = normalizarAnalise({ dores: ['   ', 'preço alto', ''], tarefas: ['enviar proposta'] })
    expect(r.dores).toEqual(['preço alto'])
    expect(r.tarefas).toEqual(['enviar proposta'])
  })
})
