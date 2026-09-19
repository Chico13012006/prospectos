import { describe, expect, it } from 'vitest'
import { efeitoEnvioProspeccao, leadBloqueadoParaEnvioProspeccao } from '../prospeccaoEnvio'

describe('leadBloqueadoParaEnvioProspeccao', () => {
  it('bloqueia lead nulo/ausente', () => {
    expect(leadBloqueadoParaEnvioProspeccao(null)).toBe(true)
    expect(leadBloqueadoParaEnvioProspeccao(undefined)).toBe(true)
  })

  it('bloqueia optout, bounced, perdido e descartado', () => {
    expect(leadBloqueadoParaEnvioProspeccao({ optout: true, bounced: false, perdido: false, estagio: 'follow_up' })).toBe(true)
    expect(leadBloqueadoParaEnvioProspeccao({ optout: false, bounced: true, perdido: false, estagio: 'follow_up' })).toBe(true)
    expect(leadBloqueadoParaEnvioProspeccao({ optout: false, bounced: false, perdido: true, estagio: 'follow_up' })).toBe(true)
    expect(leadBloqueadoParaEnvioProspeccao({ optout: false, bounced: false, perdido: false, estagio: 'descartado' })).toBe(true)
  })

  it('libera lead são em cadência', () => {
    expect(leadBloqueadoParaEnvioProspeccao({ optout: false, bounced: false, perdido: false, estagio: 'follow_up' })).toBe(false)
  })
})

describe('efeitoEnvioProspeccao', () => {
  it('1º contato: novos_leads -> primeiro_contato, tipo abordagem, followups não muda', () => {
    const efeito = efeitoEnvioProspeccao('novos_leads', 0)
    expect(efeito).toEqual({ tipoInteracao: 'abordagem', estagioDestino: 'primeiro_contato', followupsEnviados: 0 })
  })

  it('vocabulário legado "novo" também conta como 1º contato', () => {
    const efeito = efeitoEnvioProspeccao('novo', 0)
    expect(efeito.tipoInteracao).toBe('abordagem')
    expect(efeito.estagioDestino).toBe('primeiro_contato')
  })

  it('1º follow-up: primeiro_contato -> follow_up, tipo follow_up, incrementa cache', () => {
    const efeito = efeitoEnvioProspeccao('primeiro_contato', 0)
    expect(efeito).toEqual({ tipoInteracao: 'follow_up', estagioDestino: 'follow_up', followupsEnviados: 1 })
  })

  it('follow-ups seguintes: permanece em follow_up e incrementa o cache a cada envio', () => {
    const primeiro = efeitoEnvioProspeccao('primeiro_contato', 0)
    const segundo = efeitoEnvioProspeccao(primeiro.estagioDestino, primeiro.followupsEnviados)
    const terceiro = efeitoEnvioProspeccao(segundo.estagioDestino, segundo.followupsEnviados)
    expect(segundo).toEqual({ tipoInteracao: 'follow_up', estagioDestino: 'follow_up', followupsEnviados: 2 })
    expect(terceiro).toEqual({ tipoInteracao: 'follow_up', estagioDestino: 'follow_up', followupsEnviados: 3 })
  })
})
