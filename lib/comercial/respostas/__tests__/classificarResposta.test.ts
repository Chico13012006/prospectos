import { describe, it, expect } from 'vitest'
import { classificarPorRegra, classificarResposta, type ClassificadorIa } from '../classificarResposta'

const iaFixa = (r: 'positivo' | 'negativo' | 'neutro' | null): ClassificadorIa => async () => r
const iaQueLanca: ClassificadorIa = async () => { throw new Error('IA fora do ar') }

describe('classificarResposta — regras determinísticas', () => {
  it('recusa/opt-out explícito é negativo sem chamar a IA', async () => {
    let chamadas = 0
    const ia: ClassificadorIa = async () => { chamadas++; return 'positivo' }
    for (const corpo of ['Não temos interesse, obrigado.', 'Por favor remova meu e-mail da lista', 'UNSUBSCRIBE', 'parem de enviar isso']) {
      const r = await classificarResposta({ assunto: 'Re: proposta', corpo }, ia)
      expect(r).toMatchObject({ classificacao: 'negativo', via: 'regra' })
    }
    expect(chamadas).toBe(0)
    expect(classificarPorRegra({ assunto: '', corpo: 'Podemos conversar amanhã?' })).toBeNull()
  })

  it('corpo vazio → indeterminado (não dispara handoff)', async () => {
    const r = await classificarResposta({ assunto: 'Re:', corpo: '   ' }, iaFixa('positivo'))
    expect(r.classificacao).toBe('indeterminado')
  })
})

describe('classificarResposta — IA', () => {
  it('positivo/negativo/neutro vêm da IA quando a regra não decide', async () => {
    for (const esperado of ['positivo', 'negativo', 'neutro'] as const) {
      const r = await classificarResposta({ assunto: 'Re: proposta', corpo: 'Me conta mais sobre a solução.' }, iaFixa(esperado))
      expect(r).toEqual({ classificacao: esperado, via: 'ia' })
    }
  })

  it('IA ausente, inválida ou com erro → indeterminado, nunca lança', async () => {
    const msg = { assunto: 'Re: proposta', corpo: 'Interessante, vamos falar.' }
    expect(await classificarResposta(msg, null)).toMatchObject({ classificacao: 'indeterminado', via: 'indisponivel' })
    expect(await classificarResposta(msg, iaFixa(null))).toMatchObject({ classificacao: 'indeterminado', via: 'indisponivel' })
    expect(await classificarResposta(msg, iaQueLanca)).toMatchObject({ classificacao: 'indeterminado', via: 'indisponivel', motivo: 'IA fora do ar' })
  })
})
