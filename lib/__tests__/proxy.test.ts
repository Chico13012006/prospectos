import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { describe, expect, it } from 'vitest'

import { config } from '../../proxy'

function passaPeloProxy(url: string) {
  return unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url,
  })
}

describe('matcher do proxy', () => {
  it('libera os ícones públicos sem exigir autenticação', () => {
    expect(passaPeloProxy('/favicon.ico')).toBe(false)
    expect(passaPeloProxy('/icon.svg')).toBe(false)
  })

  it('libera imagens estáticas de public/ (logos de templates de e-mail)', () => {
    expect(passaPeloProxy('/next.svg')).toBe(false)
    expect(passaPeloProxy('/laudos/logo-laudo-tecnico.jpg')).toBe(false)
    expect(passaPeloProxy('/proposta/base-proposta.png')).toBe(false)
  })

  it('mantém as páginas privadas protegidas', () => {
    expect(passaPeloProxy('/dashboard')).toBe(true)
    expect(passaPeloProxy('/pipeline')).toBe(true)
  })
})
