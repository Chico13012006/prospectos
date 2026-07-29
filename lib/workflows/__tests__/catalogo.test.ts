import { describe, it, expect } from 'vitest'
import {
  ACOES,
  GATILHOS,
  acharBlocoDef,
  blocoPadrao,
  configPadrao,
  definicaoVazia,
  descreverBloco,
} from '../catalogo'
import { registrarBlocosPadrao } from '../blocos'

describe('catálogo de blocos (UI)', () => {
  it('todo tipo do catálogo tem handler registrado no motor', () => {
    const reg = registrarBlocosPadrao()
    for (const g of GATILHOS) expect(() => reg.obterGatilho(g.tipo)).not.toThrow()
    // condições/ações do catálogo também existem no registro
    expect(() => reg.obterCondicao('lead_respondeu')).not.toThrow()
    for (const a of ACOES) expect(() => reg.obterAcao(a.tipo)).not.toThrow()
  })

  it('configPadrao usa os padrões dos campos com o tipo certo (número/booleano reais)', () => {
    const esperar = acharBlocoDef('esperar')!
    expect(configPadrao(esperar)).toEqual({ dias: 2, horas: 0 })
    const cond = acharBlocoDef('lead_respondeu')!
    expect(configPadrao(cond)).toEqual({ respondeu: true })
    expect(typeof configPadrao(cond).respondeu).toBe('boolean')
  })

  it('blocoPadrao instancia { tipo, config }', () => {
    const bloco = blocoPadrao(acharBlocoDef('enviar_email')!)
    expect(bloco).toEqual({ tipo: 'enviar_email', config: { template: 'follow_up_1' } })
  })

  it('definicaoVazia é gatilho padrão + listas vazias', () => {
    const def = definicaoVazia()
    expect(def.gatilho.tipo).toBe('campo_data_vence')
    expect(def.condicoes).toEqual([])
    expect(def.acoes).toEqual([])
  })

  it('descreverBloco resolve rótulos de opções (select/booleano)', () => {
    expect(descreverBloco({ tipo: 'enviar_email', config: { template: 'follow_up_1' } })).toBe(
      'Enviar e-mail · Follow-up 1',
    )
    expect(descreverBloco({ tipo: 'lead_respondeu', config: { respondeu: false } })).toBe(
      'Lead respondeu? · Não respondeu',
    )
    expect(descreverBloco({ tipo: 'esperar', config: { dias: 3, horas: 0 } })).toBe('Esperar · 3 · 0')
  })

  it('descreverBloco cai no tipo cru para bloco desconhecido', () => {
    expect(descreverBloco({ tipo: 'inexistente', config: {} })).toBe('inexistente')
  })
})
