import { describe, expect, it } from 'vitest'
import {
  aguardandoRespostasDoDisparo,
  execucoesPendentes,
  temFalhaOperacional,
  type ResumoExecucoesSituacao,
} from '../situacaoDisparo'

const resumo = (parcial: Partial<ResumoExecucoesSituacao> = {}): ResumoExecucoesSituacao => ({
  total: 4, emAndamento: 0, aguardando: 0, canceladas: 0, erros: 0, respostas: 0, ...parcial,
})

const disparoConcluido = {
  disparoUnico: true,
  status: 'ativa',
  emEnsaio: false,
  resumo: resumo(),
}

describe('situação do disparo', () => {
  it('marca aguardando respostas quando tudo saiu e ninguém respondeu', () => {
    expect(aguardandoRespostasDoDisparo(disparoConcluido)).toBe(true)
  })

  it('para de marcar assim que a primeira resposta chega', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ respostas: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ respostas: 4 }) })).toBe(false)
  })

  it('não marca campanha com cadência — o servidor não recusa concluir essas', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, disparoUnico: false })).toBe(false)
  })

  it('não marca enquanto há envio na fila, nem quando algo falhou', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ aguardando: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ emAndamento: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ canceladas: 1 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ erros: 1 }) })).toBe(false)
  })

  it('não marca simulação, campanha fora do ar ou disparo que nunca inscreveu ninguém', () => {
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, emEnsaio: true })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, status: 'pausada' })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: resumo({ total: 0 }) })).toBe(false)
    expect(aguardandoRespostasDoDisparo({ ...disparoConcluido, resumo: null })).toBe(false)
  })

  it('trata resumo ausente sem quebrar os auxiliares', () => {
    expect(temFalhaOperacional(null)).toBe(false)
    expect(temFalhaOperacional(resumo({ erros: 2 }))).toBe(true)
    expect(execucoesPendentes(undefined)).toBe(0)
    expect(execucoesPendentes(resumo({ emAndamento: 2, aguardando: 3 }))).toBe(5)
  })
})
