import { describe, it, expect, vi, beforeEach } from 'vitest'

// Anexos no GmailProvider: aditivos (sem anexo, a chamada ao SMTP fica igual)
// e sob MODO_ENSAIO nada sai. nodemailer e a config do motor são simulados.

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (_opcoes: Record<string, unknown>) => ({ messageId: 'MID-1' })),
  modoEnsaio: false,
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}))

vi.mock('@/lib/engine/config', () => ({
  engineConfig: {
    get modoEnsaio() { return mocks.modoEnsaio },
  },
}))

import { GmailProvider } from '../email/gmailProvider'

const CRED = { user: 'vendas@acme.com', appPassword: 'x' }
const PDF = new Uint8Array([37, 80, 68, 70])

describe('GmailProvider.enviar — anexos', () => {
  beforeEach(() => {
    mocks.sendMail.mockClear()
    mocks.modoEnsaio = false
  })

  it('envia o PDF como attachment (nome, conteúdo e MIME)', async () => {
    await new GmailProvider(CRED).enviar('cliente@x.com', 'Proposta', 'Olá', '<p>Olá</p>', undefined, [
      { nomeArquivo: 'proposta-acme-2026-09-14.pdf', conteudo: PDF, tipo: 'application/pdf' },
    ])
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    const opcoes = mocks.sendMail.mock.calls[0][0] as { attachments: Array<{ filename: string; content: Buffer; contentType: string }> }
    expect(opcoes.attachments).toHaveLength(1)
    expect(opcoes.attachments[0].filename).toBe('proposta-acme-2026-09-14.pdf')
    expect(opcoes.attachments[0].contentType).toBe('application/pdf')
    expect(new Uint8Array(opcoes.attachments[0].content)).toEqual(PDF)
  })

  it('sem anexos a mensagem não ganha a chave attachments (call sites antigos)', async () => {
    await new GmailProvider(CRED).enviar('cliente@x.com', 'Assunto', 'Corpo')
    expect(mocks.sendMail.mock.calls[0][0]).not.toHaveProperty('attachments')
  })

  it('MODO_ENSAIO: nada é enviado, com ou sem anexo', async () => {
    mocks.modoEnsaio = true
    await new GmailProvider(CRED).enviar('cliente@x.com', 'Proposta', 'Olá', undefined, undefined, [
      { nomeArquivo: 'a.pdf', conteudo: PDF, tipo: 'application/pdf' },
    ])
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
})
