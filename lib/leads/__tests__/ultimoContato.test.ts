import { describe, expect, it } from 'vitest'
import { ultimoContatoEfetivo } from '../ultimoContato'

describe('último contato efetivo', () => {
  it('usa a interação de e-mail mais recente quando o campo do lead está atrasado', () => {
    expect(ultimoContatoEfetivo('2026-08-13T10:00:00.000Z', [
      { canal: 'sistema', created_at: '2026-08-24T15:30:00.000Z' },
      { canal: 'email', created_at: '2026-08-24T14:17:00.000Z' },
    ])).toBe('2026-08-24T14:17:00.000Z')
  })

  it('preserva o campo persistido quando ele já é o mais recente', () => {
    expect(ultimoContatoEfetivo('2026-08-24T15:00:00.000Z', [
      { canal: 'email', created_at: '2026-08-24T14:17:00.000Z' },
    ])).toBe('2026-08-24T15:00:00.000Z')
  })

  it('ignora datas inválidas e retorna null sem evidência de contato', () => {
    expect(ultimoContatoEfetivo('inválida', [
      { canal: 'email', created_at: null },
      { canal: 'sistema', created_at: '2026-08-24T15:00:00.000Z' },
    ])).toBeNull()
  })
})
