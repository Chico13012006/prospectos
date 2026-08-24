import { describe, expect, it } from 'vitest'
import {
  JANELA_PADRAO_RESPOSTAS_DIAS,
  montarBuscaMensagensRecentes,
} from '../email/gmailProvider'

describe('GmailProvider — janela de respostas', () => {
  it('busca mensagens recentes sem depender da flag de não lida', () => {
    const agora = new Date('2026-08-24T15:00:00.000Z')

    const busca = montarBuscaMensagensRecentes(agora)

    expect(JANELA_PADRAO_RESPOSTAS_DIAS).toBe(30)
    expect(busca.since.toISOString()).toBe('2026-07-25T15:00:00.000Z')
    expect(busca).not.toHaveProperty('seen')
  })

  it('aceita janela configurável e limita valores excessivos', () => {
    const agora = new Date('2026-08-24T15:00:00.000Z')

    expect(montarBuscaMensagensRecentes(agora, '7').since.toISOString())
      .toBe('2026-08-17T15:00:00.000Z')
    expect(montarBuscaMensagensRecentes(agora, '365').since.toISOString())
      .toBe('2026-05-26T15:00:00.000Z')
    expect(montarBuscaMensagensRecentes(agora, 'invalido').since.toISOString())
      .toBe('2026-07-25T15:00:00.000Z')
  })
})
