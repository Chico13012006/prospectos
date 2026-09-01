import { afterEach, describe, expect, it } from 'vitest'
import { lerCredenciaisGmail } from '../gmailProvider'

const chaves = [
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'GMAIL_USER_LAUDO',
  'GMAIL_APP_PASSWORD_LAUDO',
]
const originais = Object.fromEntries(chaves.map((chave) => [chave, process.env[chave]]))

afterEach(() => {
  for (const chave of chaves) {
    const valor = originais[chave]
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
})

describe('lerCredenciaisGmail', () => {
  it('não usa a conta padrão como fallback de uma chave por organização', () => {
    process.env.GMAIL_USER = 'padrao@inova.test'
    process.env.GMAIL_APP_PASSWORD = 'segredo-padrao'
    delete process.env.GMAIL_USER_LAUDO
    delete process.env.GMAIL_APP_PASSWORD_LAUDO

    expect(lerCredenciaisGmail('LAUDO')).toBeNull()
  })

  it('resolve a credencial dedicada quando a chave por organização existe', () => {
    process.env.GMAIL_USER_LAUDO = 'comercial@laudos.test'
    process.env.GMAIL_APP_PASSWORD_LAUDO = 'segredo-laudo'

    expect(lerCredenciaisGmail('LAUDO')).toEqual({
      user: 'comercial@laudos.test',
      appPassword: 'segredo-laudo',
    })
  })
})
