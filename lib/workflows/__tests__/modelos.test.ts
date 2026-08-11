// Fase 11: os modelos de workflow são estruturalmente válidos — todo bloco
// (gatilho/condições/ações) usa um `tipo` REGISTRADO em registrarBlocosPadrao.
// Se alguém remover/renomear um bloco usado por um modelo, este teste quebra.
import { describe, it, expect } from 'vitest'
import { MODELOS, modeloPorChave } from '../modelos'
import { registrarBlocosPadrao } from '../blocos'

const registro = registrarBlocosPadrao()

describe('modelos de workflow (Fase 11)', () => {
  it('inclui Prospecção 0/3/7 e Renovação 45d', () => {
    expect(modeloPorChave('prospeccao_0_3_7')).toBeDefined()
    expect(modeloPorChave('renovacao_45d')).toBeDefined()
  })

  it('todo bloco de cada modelo está registrado no motor', () => {
    for (const m of MODELOS) {
      expect(() => registro.obterGatilho(m.definicao.gatilho.tipo)).not.toThrow()
      for (const c of m.definicao.condicoes) expect(() => registro.obterCondicao(c.tipo)).not.toThrow()
      for (const a of m.definicao.acoes) expect(() => registro.obterAcao(a.tipo)).not.toThrow()
    }
  })

  it('chaves são únicas', () => {
    const chaves = MODELOS.map((m) => m.chave)
    expect(new Set(chaves).size).toBe(chaves.length)
  })
})
