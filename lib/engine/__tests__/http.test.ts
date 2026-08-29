import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autorizar } from '../http'

const internalOriginal = process.env.INTERNAL_SECRET
const cronOriginal = process.env.CRON_SECRET

describe('autorizar', () => {
  beforeEach(() => {
    process.env.INTERNAL_SECRET = 'internal-test'
    process.env.CRON_SECRET = 'cron-test'
  })

  afterEach(() => {
    if (internalOriginal === undefined) delete process.env.INTERNAL_SECRET
    else process.env.INTERNAL_SECRET = internalOriginal
    if (cronOriginal === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = cronOriginal
  })

  it('aceita o segredo interno pelo header dedicado', () => {
    const req = new Request('https://app.test/api/engine/follow-up', {
      headers: { 'x-internal-secret': 'internal-test' },
    })
    expect(autorizar(req)).toBeNull()
  })

  it('aceita CRON_SECRET no Authorization Bearer enviado pelo Vercel', () => {
    const req = new Request('https://app.test/api/renovacao/processar', {
      headers: { authorization: 'Bearer cron-test' },
    })
    expect(autorizar(req)).toBeNull()
  })

  it('rejeita segredo inválido', () => {
    const req = new Request('https://app.test/api/renovacao/processar', {
      headers: { authorization: 'Bearer incorreto' },
    })
    expect(autorizar(req)?.status).toBe(401)
  })

  it('falha de forma explícita quando nenhum segredo está configurado', () => {
    delete process.env.INTERNAL_SECRET
    delete process.env.CRON_SECRET
    const req = new Request('https://app.test/api/renovacao/processar')
    expect(autorizar(req)?.status).toBe(500)
  })
})
