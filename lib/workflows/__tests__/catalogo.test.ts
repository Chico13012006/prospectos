import { describe, it, expect } from 'vitest'
import {
  ACOES,
  CONDICOES,
  GATILHOS,
  acharBlocoDef,
  blocoPadrao,
  configPadrao,
  definicaoVazia,
  descreverBloco,
  garantirIdsAcoes,
} from '../catalogo'
import { registrarBlocosPadrao } from '../blocos'

describe('catálogo de blocos (UI)', () => {
  it('todo tipo do catálogo tem handler registrado no motor', () => {
    const reg = registrarBlocosPadrao()
    for (const g of GATILHOS) expect(() => reg.obterGatilho(g.tipo)).not.toThrow()
    for (const c of CONDICOES) expect(() => reg.obterCondicao(c.tipo)).not.toThrow()
    for (const a of ACOES) expect(() => reg.obterAcao(a.tipo)).not.toThrow()
  })

  it('configPadrao usa os padrões dos campos com o tipo certo (número/booleano reais)', () => {
    const esperar = acharBlocoDef('esperar')!
    expect(configPadrao(esperar)).toEqual({ dias: 2, horas: 0 })
    const cond = acharBlocoDef('lead_respondeu')!
    expect(configPadrao(cond)).toEqual({ respondeu: true })
    expect(typeof configPadrao(cond).respondeu).toBe('boolean')
  })

  it('configPadrao usa configInicial (config aninhado) e devolve clone independente', () => {
    const a = configPadrao(acharBlocoDef('saltar_se')!)
    const b = configPadrao(acharBlocoDef('saltar_se')!)
    expect(a).toEqual({ condicao: { tipo: 'lead_respondeu', config: { respondeu: true } }, destino: '' })
    ;(a.condicao as { tipo: string }).tipo = 'campo'
    expect((b.condicao as { tipo: string }).tipo).toBe('lead_respondeu') // não compartilha referência
  })

  it('blocoPadrao instancia { id, tipo, config } com id estável', () => {
    const bloco = blocoPadrao(acharBlocoDef('enviar_email')!)
    expect(bloco.tipo).toBe('enviar_email')
    expect(bloco.config).toEqual({ template: 'follow_up_1' })
    expect(typeof bloco.id).toBe('string')
    expect(bloco.id).not.toBe(blocoPadrao(acharBlocoDef('enviar_email')!).id) // ids distintos
  })

  it('definicaoVazia é gatilho padrão + listas vazias', () => {
    const def = definicaoVazia()
    expect(def.gatilho.tipo).toBe('campo_data_vence')
    expect(def.condicoes).toEqual([])
    expect(def.acoes).toEqual([])
  })

  it('garantirIdsAcoes backfill de ids em ações sem id (idempotente p/ quem já tem)', () => {
    const comId = { id: 'fixo', tipo: 'criar_tarefa', config: {} }
    const def = garantirIdsAcoes({
      gatilho: { tipo: 'campo_data_vence', config: {} },
      condicoes: [],
      acoes: [{ tipo: 'esperar', config: {} }, comId],
    })
    expect(typeof def.acoes[0].id).toBe('string') // ganhou id
    expect(def.acoes[1].id).toBe('fixo') // preservado
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

  it('descreverBloco resolve campo tipo usuario (responsavel_id → nome) quando há lista', () => {
    const usuarios = [{ id: 'u-1', nome: 'Francisco' }]
    const bloco = { tipo: 'criar_tarefa', config: { titulo: 'Ligar', responsavel_id: 'u-1' } }
    expect(descreverBloco(bloco, usuarios)).toBe('Criar tarefa · Ligar · Francisco')
    // Sem lista (fallback): mantém o UUID cru.
    expect(descreverBloco(bloco)).toBe('Criar tarefa · Ligar · u-1')
    // Id fora da lista: também cai no cru.
    expect(descreverBloco(bloco, [{ id: 'outro', nome: 'X' }])).toBe('Criar tarefa · Ligar · u-1')
  })
})
