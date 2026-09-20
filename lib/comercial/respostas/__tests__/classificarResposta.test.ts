import { describe, it, expect } from 'vitest'
import { classificarPorRegra, classificarResposta, textoNovoDaResposta, type ClassificadorIa } from '../classificarResposta'

// Rodapé real das campanhas (lib/campanhas + biblioteca de templates): o texto
// tem 'descadastrar', que casa com PADROES_NEGATIVOS.
const RODAPE_CAMPANHA = 'Caso não queira mais receber nossos e-mails, clique aqui para se descadastrar.'

// Resposta real da campanha TESTE FLUXO (19/09/2026), com a citação do Gmail.
const RESPOSTA_COM_CITACAO = `Top, tenho interesse

Em sáb., 19 de set. de 2026 às 16:11, <franciscorufinotech@gmail.com>
escreveu:

> Prospecção
>
> Olá, *Francisco*, tudo bem?
>
> ${RODAPE_CAMPANHA}
`

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

// REGRESSÃO 19/09/2026: a resposta "Top, tenho interesse" foi classificada como
// negativa e o lead foi para 'perdido'. O gatilho não estava na resposta: era o
// rodapé da NOSSA campanha, citado embaixo dela.
describe('classificarResposta — histórico citado não classifica', () => {
  it('resposta positiva que cita o rodapé de descadastro NÃO vira negativa', async () => {
    const r = await classificarResposta(
      { assunto: 'Re: TESTE FLUXO', corpo: RESPOSTA_COM_CITACAO },
      iaFixa('positivo'),
    )
    expect(r).toEqual({ classificacao: 'positivo', via: 'ia' })
  })

  it('a IA recebe só o texto novo, sem a mensagem original', async () => {
    let corpoVisto = ''
    const ia: ClassificadorIa = async (resposta) => { corpoVisto = resposta.corpo; return 'positivo' }
    await classificarResposta({ assunto: 'Re: TESTE FLUXO', corpo: RESPOSTA_COM_CITACAO }, ia)
    expect(corpoVisto.trim()).toBe('Top, tenho interesse')
    expect(corpoVisto).not.toContain('descadastrar')
  })

  it('recusa escrita pelo lead continua negativa mesmo com citação embaixo', async () => {
    const r = await classificarResposta(
      { assunto: 'Re: TESTE FLUXO', corpo: `Não tenho interesse.\n\nEm sáb., 19 de set. de 2026, alguém escreveu:\n> ${RODAPE_CAMPANHA}` },
      iaFixa('positivo'),
    )
    expect(r).toMatchObject({ classificacao: 'negativo', via: 'regra' })
  })

  it('resposta ambígua continua sendo decidida pela IA usando somente o texto novo', async () => {
    let corpoVisto = ''
    const ia: ClassificadorIa = async (resposta) => { corpoVisto = resposta.corpo; return 'neutro' }
    const r = await classificarResposta(
      { assunto: 'Re: TESTE FLUXO', corpo: `Talvez no próximo trimestre.\n\nEm sáb., 19 de set. de 2026, alguém escreveu:\n> ${RODAPE_CAMPANHA}` },
      ia,
    )

    expect(r).toEqual({ classificacao: 'neutro', via: 'ia' })
    expect(corpoVisto).toBe('Talvez no próximo trimestre.\n\n')
  })

  it('resposta só com a citação (sem texto novo) → indeterminado, não negativo', async () => {
    const r = await classificarResposta(
      { assunto: 'Re: TESTE FLUXO', corpo: `Em sáb., 19 de set. de 2026, alguém escreveu:\n> ${RODAPE_CAMPANHA}` },
      iaFixa('positivo'),
    )
    expect(r).toMatchObject({ classificacao: 'indeterminado', via: 'regra', motivo: 'corpo vazio' })
  })

  it('textoNovoDaResposta corta nos marcadores conhecidos e preserva o resto', () => {
    expect(textoNovoDaResposta(RESPOSTA_COM_CITACAO).trim()).toBe('Top, tenho interesse')
    expect(textoNovoDaResposta('Vamos conversar\n\nOn Sat, Sep 19, 2026 at 4:11 PM John wrote:\n> oi').trim())
      .toBe('Vamos conversar')
    expect(textoNovoDaResposta('Bom dia\n\n-----Mensagem original-----\nDe: alguém').trim()).toBe('Bom dia')
    expect(textoNovoDaResposta('Bom dia\n\n__________________________\nDe: alguém').trim()).toBe('Bom dia')
    // Sem marcador de citação, nada é cortado.
    expect(textoNovoDaResposta('Tenho interesse, me liga amanhã.'))
      .toBe('Tenho interesse, me liga amanhã.')
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
